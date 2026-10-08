"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const DATA_DIRECTORY = path.join(ROOT, "data");
const DATABASE_PATH =
  process.env.DATABASE_PATH || path.join(DATA_DIRECTORY, "loja.sqlite");
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_ORDERS_PER_REQUEST = 50;
const PASSWORD_HASH_BYTES = 64;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_AUTH_ATTEMPTS = 10;
const AUTH_RATE_LIMIT = new Map();

const PRODUCT_PRICES_CENTS = new Map([
  ["Caneca alça branca", 3000],
  ["Sabonete aromatizado", 250],
  ["Chaveiro", 300],
  ["Placa de mesa", 250],
  ["Caixinha", 550],
  ["Caneca alça colorida", 4000],
  ["Card", 50],
  ["Taça", 450],
  ["Display", 500],
  ["Caneca de chopp", 5000],
  ["Copo long drink", 350],
  ["Chaveiro e Card", 350],
  ["Forma de brigadeiro", 50],
  ["Topo de bolo", 450],
  ["Balde de pipoca", 500],
  ["Caneca acrílica", 450],
  ["Almofada", 850],
]);
const PRODUCT_NAMES = new Set([
  ...PRODUCT_PRICES_CENTS.keys(),
  "Copo americano acrílico",
  "Azulejo",
]);

const ORDER_STATUSES = new Set([
  "aguardando_contato",
  "em_producao",
  "pronto",
  "finalizado",
]);

const MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function initializeDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);

  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_expiration
      ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'aguardando_contato',
      total_cents INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS orders_customer_date
      ON orders(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER
    );

    CREATE TABLE IF NOT EXISTS customer_favorites (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (user_id, product_name)
    );
  `);

  const userColumns = database.prepare("PRAGMA table_info(users)").all();
  if (!userColumns.some((column) => column.name === "phone")) {
    database.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
  }

  database
    .prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .run(Date.now());

  return database;
}

function validatePhone(value) {
  if (typeof value !== "string") return null;
  const phone = value.replace(/\D/g, "");
  return phone.length === 10 || phone.length === 11 ? phone : null;
}

function jsonResponse(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function requestCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) continue;

    const cookieName = part.slice(0, separatorIndex).trim();
    if (cookieName === name) {
      return part.slice(separatorIndex + 1).trim();
    }
  }

  return null;
}

function sessionCookie(value, maxAgeSeconds, secure) {
  return [
    `loja_session=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function requestIsSecure(request) {
  return (
    Boolean(request.socket.encrypted) ||
    (process.env.TRUST_PROXY === "1" &&
      request.headers["x-forwarded-proto"] === "https")
  );
}

function sessionTokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function requireSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;

  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        const error = new Error("A solicitação é muito grande.");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error("O conteúdo enviado é inválido.");
        error.statusCode = 400;
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function authRateLimitKey(request, email) {
  return `${request.socket.remoteAddress || "unknown"}:${email}`;
}

function checkAuthRateLimit(request, email) {
  const key = authRateLimitKey(request, email);
  const attempts = AUTH_RATE_LIMIT.get(key);

  if (!attempts || attempts.expiresAt <= Date.now()) {
    AUTH_RATE_LIMIT.set(key, {
      count: 0,
      expiresAt: Date.now() + RATE_LIMIT_WINDOW_MS,
    });
  }

  return AUTH_RATE_LIMIT.get(key);
}

function clearAuthRateLimit(request, email) {
  AUTH_RATE_LIMIT.delete(authRateLimitKey(request, email));
}

function createSession(database, userId, response, request) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_DURATION_MS;

  database
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    )
    .run(sessionTokenHash(token), userId, expiresAt);

  const secure = requestIsSecure(request);
  response.setHeader(
    "Set-Cookie",
    sessionCookie(token, SESSION_DURATION_MS / 1000, secure),
  );
}

function currentUser(database, request) {
  const token = requestCookie(request, "loja_session");
  if (!token || token.length > 100) return null;

  const session = database
    .prepare(
      `SELECT users.id, users.name, users.email, users.phone
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(sessionTokenHash(token), Date.now());

  return session || null;
}

function userResponse(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
  };
}

function validateEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

function validatePassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 4 &&
    value.length <= 128 &&
    !value.includes("\0")
  );
}

function passwordMatches(password, salt, expectedHash) {
  const actualHash = crypto.scryptSync(
    password,
    salt,
    PASSWORD_HASH_BYTES,
  );
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  return (
    actualHash.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualHash, expectedBuffer)
  );
}

function customerOrders(database, userId) {
  const orders = database
    .prepare(
      `SELECT id, status, total_cents, created_at
       FROM orders
       WHERE user_id = ?
       ORDER BY created_at DESC`,
    )
    .all(userId);

  const findItems = database.prepare(
    `SELECT product_name, quantity, unit_price_cents
     FROM order_items
     WHERE order_id = ?
     ORDER BY id`,
  );

  return orders.map((order) => ({
    id: order.id,
    status: order.status,
    totalCents: order.total_cents,
    createdAt: order.created_at,
    items: findItems.all(order.id).map((item) => ({
      name: item.product_name,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
    })),
  }));
}

function createOrder(database, userId, products) {
  if (
    !Array.isArray(products) ||
    products.length === 0 ||
    products.length > MAX_ORDERS_PER_REQUEST
  ) {
    return null;
  }

  const items = [];
  let totalCents = 0;
  let hasUnpricedItems = false;

  for (const product of products) {
    if (
      !product ||
      typeof product.name !== "string" ||
      !PRODUCT_NAMES.has(product.name) ||
      !Number.isSafeInteger(product.quantity) ||
      product.quantity < 1 ||
      product.quantity > 50
    ) {
      return null;
    }

    const unitPriceCents = PRODUCT_PRICES_CENTS.has(product.name)
      ? PRODUCT_PRICES_CENTS.get(product.name)
      : null;
    if (unitPriceCents === null) {
      hasUnpricedItems = true;
    } else {
      totalCents += unitPriceCents * product.quantity;
    }

    items.push({
      name: product.name,
      quantity: product.quantity,
      unitPriceCents,
    });
  }

  const orderId = crypto.randomUUID();
  const storedTotalCents = hasUnpricedItems ? null : totalCents;

  database.exec("BEGIN");
  try {
    database
      .prepare(
        "INSERT INTO orders (id, user_id, total_cents) VALUES (?, ?, ?)",
      )
      .run(orderId, userId, storedTotalCents);

    const insertItem = database.prepare(
      `INSERT INTO order_items
       (order_id, product_name, quantity, unit_price_cents)
       VALUES (?, ?, ?, ?)`,
    );
    for (const item of items) {
      insertItem.run(
        orderId,
        item.name,
        item.quantity,
        item.unitPriceCents,
      );
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return {
    id: orderId,
    status: "aguardando_contato",
    totalCents: storedTotalCents,
    items,
  };
}

async function serveStatic(request, response, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    jsonResponse(response, 400, { error: "O endereço solicitado é inválido." });
    return;
  }

  const relativePath =
    decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);
  const relativeToRoot = path.relative(ROOT, filePath);

  if (
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot) ||
    relativeToRoot === "server.js" ||
    relativeToRoot === "package.json" ||
    relativeToRoot.startsWith(`data${path.sep}`) ||
    relativeToRoot.startsWith(".")
  ) {
    jsonResponse(response, 404, { error: "Página não encontrada." });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES.get(extension);
  if (!mimeType) {
    jsonResponse(response, 404, { error: "Arquivo não encontrado." });
    return;
  }

  let file;
  try {
    file = await fs.promises.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      jsonResponse(response, 404, { error: "Página não encontrada." });
      return;
    }
    throw error;
  }

  response.writeHead(200, {
    "Cache-Control":
      [".html", ".css", ".js"].includes(extension)
        ? "no-cache"
        : "public, max-age=3600",
    "Content-Length": file.length,
    "Content-Type": mimeType,
  });
  response.end(request.method === "HEAD" ? undefined : file);
}

function createStoreServer(options = {}) {
  const database = initializeDatabase(
    options.databasePath || DATABASE_PATH,
  );

  const server = http.createServer(async (request, response) => {
    setSecurityHeaders(response);

    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    } catch {
      jsonResponse(response, 400, { error: "O endereço solicitado é inválido." });
      return;
    }

    const { pathname } = url;

    try {
      if (pathname.startsWith("/api/")) {
        if (request.method === "OPTIONS") {
          response.writeHead(204, { Allow: "GET, POST, OPTIONS" });
          response.end();
          return;
        }

        if (!["GET", "POST", "DELETE"].includes(request.method)) {
          jsonResponse(
            response,
            405,
            { error: "Método não permitido." },
            { Allow: "GET, POST, DELETE, OPTIONS" },
          );
          return;
        }

        if (
          ["POST", "DELETE"].includes(request.method) &&
          (!requireSameOrigin(request) ||
            request.headers["sec-fetch-site"] === "cross-site")
        ) {
          jsonResponse(response, 403, { error: "Origem da solicitação inválida." });
          return;
        }

        if (pathname === "/api/auth/me" && request.method === "GET") {
          const user = currentUser(database, request);
          jsonResponse(response, 200, {
            user: user ? userResponse(user) : null,
          });
          return;
        }

        if (
          pathname === "/api/auth/register" &&
          request.method === "POST"
        ) {
          const body = await readJsonBody(request);
          const name =
            typeof body.name === "string" ? body.name.trim() : "";
          const email = validateEmail(body.email);
          const phone = validatePhone(body.phone);

          if (name.length < 2 || name.length > 100 || !email || !phone) {
            jsonResponse(response, 400, {
              error: "Informe seu nome, um e-mail válido e um telefone com DDD.",
            });
            return;
          }

          if (!validatePassword(body.password)) {
            jsonResponse(response, 400, {
              error: "A senha precisa ter de 4 a 128 caracteres.",
            });
            return;
          }

          const rateLimit = checkAuthRateLimit(request, email);
          if (rateLimit.count >= MAX_AUTH_ATTEMPTS) {
            jsonResponse(response, 429, {
              error: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
            });
            return;
          }
          rateLimit.count += 1;

          const salt = crypto.randomBytes(16);
          const passwordHash = crypto.scryptSync(
            body.password,
            salt,
            PASSWORD_HASH_BYTES,
          );
          let result;

          try {
            result = database
              .prepare(
                `INSERT INTO users (name, email, phone, password_hash, password_salt)
                 VALUES (?, ?, ?, ?, ?)`,
              )
              .run(
                name,
                email,
                phone,
                passwordHash.toString("hex"),
                salt.toString("hex"),
              );
          } catch (error) {
            if (
              error.code === "ERR_SQLITE_ERROR" &&
              error.message.includes("UNIQUE constraint failed: users.email")
            ) {
              const existingUser = database
                .prepare("SELECT id FROM users WHERE email = ?")
                .get(email);
              if (existingUser) {
                jsonResponse(response, 409, {
                  error: "Já existe uma conta com esse e-mail. Entre na sua conta.",
                });
                return;
              }
            }
            throw error;
          }

          clearAuthRateLimit(request, email);
          const user = {
            id: Number(result.lastInsertRowid),
            name,
            email,
            phone,
          };
          createSession(database, user.id, response, request);
          jsonResponse(response, 201, { user: userResponse(user) });
          return;
        }

        if (pathname === "/api/auth/login" && request.method === "POST") {
          const body = await readJsonBody(request);
          const email = validateEmail(body.email);
          const rateLimit = checkAuthRateLimit(request, email || "invalid");

          if (rateLimit.count >= MAX_AUTH_ATTEMPTS) {
            jsonResponse(response, 429, {
              error: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
            });
            return;
          }

          const user = email
            ? database
                .prepare(
                  `SELECT id, name, email, phone, password_hash, password_salt
                   FROM users
                   WHERE email = ?`,
                )
                .get(email)
            : null;
          const passwordIsValid =
            user &&
            typeof body.password === "string" &&
            body.password.length <= 128 &&
            passwordMatches(
              body.password,
              Buffer.from(user.password_salt, "hex"),
              user.password_hash,
            );

          if (!passwordIsValid) {
            rateLimit.count += 1;
            jsonResponse(response, 401, {
              error: "E-mail ou senha incorretos.",
            });
            return;
          }

          clearAuthRateLimit(request, email);
          createSession(database, user.id, response, request);
          jsonResponse(response, 200, {
            user: userResponse(user),
          });
          return;
        }

        if (
          pathname === "/api/auth/logout" &&
          request.method === "POST"
        ) {
          const token = requestCookie(request, "loja_session");
          if (token) {
            database
              .prepare("DELETE FROM sessions WHERE token_hash = ?")
              .run(sessionTokenHash(token));
          }
          response.setHeader(
            "Set-Cookie",
            sessionCookie("", 0, requestIsSecure(request)),
          );
          jsonResponse(response, 200, { success: true });
          return;
        }

        if (pathname === "/api/orders" && request.method === "GET") {
          const user = currentUser(database, request);
          if (!user) {
            jsonResponse(response, 401, { error: "Entre na sua conta para continuar." });
            return;
          }
          jsonResponse(response, 200, {
            orders: customerOrders(database, user.id),
          });
          return;
        }

        if (pathname === "/api/orders" && request.method === "POST") {
          const user = currentUser(database, request);
          if (!user) {
            jsonResponse(response, 401, { error: "Entre na sua conta para continuar." });
            return;
          }

          const body = await readJsonBody(request);
          const order = createOrder(database, user.id, body.items);
          if (!order) {
            jsonResponse(response, 400, {
              error: "Seu carrinho está vazio ou contém um item inválido.",
            });
            return;
          }

          jsonResponse(response, 201, { order });
          return;
        }

        if (pathname === "/api/favorites" && request.method === "GET") {
          const user = currentUser(database, request);
          if (!user) {
            jsonResponse(response, 401, {
              error: "Entre na sua conta para ver seus favoritos.",
            });
            return;
          }

          const favorites = database
            .prepare(
              `SELECT product_name, created_at
               FROM customer_favorites
               WHERE user_id = ?
               ORDER BY created_at DESC, product_name`,
            )
            .all(user.id)
            .map((favorite) => ({
              name: favorite.product_name,
              createdAt: favorite.created_at,
            }));
          jsonResponse(response, 200, { favorites });
          return;
        }

        if (pathname === "/api/favorites" && request.method === "POST") {
          const user = currentUser(database, request);
          if (!user) {
            jsonResponse(response, 401, {
              error: "Entre na sua conta para salvar seus favoritos.",
            });
            return;
          }

          const body = await readJsonBody(request);
          if (
            typeof body.productName !== "string" ||
            !PRODUCT_NAMES.has(body.productName)
          ) {
            jsonResponse(response, 400, {
              error: "O produto escolhido não está disponível.",
            });
            return;
          }

          database
            .prepare(
              `INSERT INTO customer_favorites (user_id, product_name)
               VALUES (?, ?)
               ON CONFLICT (user_id, product_name) DO NOTHING`,
            )
            .run(user.id, body.productName);
          jsonResponse(response, 201, {
            favorite: { name: body.productName },
          });
          return;
        }

        if (pathname === "/api/favorites" && request.method === "DELETE") {
          const user = currentUser(database, request);
          if (!user) {
            jsonResponse(response, 401, {
              error: "Entre na sua conta para remover seus favoritos.",
            });
            return;
          }

          const body = await readJsonBody(request);
          if (
            typeof body.productName !== "string" ||
            !PRODUCT_NAMES.has(body.productName)
          ) {
            jsonResponse(response, 400, {
              error: "O produto escolhido não está disponível.",
            });
            return;
          }

          database
            .prepare(
              `DELETE FROM customer_favorites
               WHERE user_id = ? AND product_name = ?`,
            )
            .run(user.id, body.productName);
          jsonResponse(response, 200, { success: true });
          return;
        }

        jsonResponse(response, 404, { error: "Serviço não encontrado." });
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        jsonResponse(
          response,
          405,
          { error: "Método não permitido." },
          { Allow: "GET, HEAD" },
        );
        return;
      }

      await serveStatic(request, response, pathname);
    } catch (error) {
      if (error.statusCode) {
        jsonResponse(response, error.statusCode, { error: error.message });
        return;
      }

      if (!response.headersSent) {
        jsonResponse(response, 500, {
          error: "Ocorreu um erro no servidor. Tente novamente.",
        });
      }
      console.error("Erro ao processar solicitação:", error);
    }
  });

  server.on("close", () => database.close());
  return server;
}

if (require.main === module) {
  const server = createStoreServer();
  server.listen(PORT, HOST, () => {
    console.log(`Loja disponível em http://localhost:${PORT}`);
    console.log(`Banco de dados: ${DATABASE_PATH}`);
  });
}

module.exports = {
  createStoreServer,
  initializeDatabase,
};
