"use strict";

const authView = document.getElementById("authView");
const customerView = document.getElementById("customerView");
const accountMessage = document.getElementById("accountMessage");
const loginPanel = document.getElementById("loginPanel");
const registerPanel = document.getElementById("registerPanel");
const showRegisterButton = document.getElementById("showRegister");
const showLoginButton = document.getElementById("showLogin");
const pendingCheckout = document.getElementById("pendingCheckout");
const whatsAppNextStep = document.getElementById("whatsAppNextStep");
const ordersList = document.getElementById("ordersList");
const query = new URLSearchParams(window.location.search);
const CART_STORAGE_KEY = "sonhoDeCrianca.cart";
const GUEST_FAVORITES_KEY = "sonhoDeCrianca.favorites";
const ACCOUNT_PRODUCT_PRICES = {
  "Caneca alça branca": 3000,
  "Sabonete aromatizado": 250,
  Chaveiro: 300,
  "Placa de mesa": 250,
  Caixinha: 550,
  "Caneca alça colorida": 4000,
  Card: 50,
  Taça: 450,
  Display: 500,
  "Caneca de chopp": 5000,
  "Copo long drink": 350,
  "Chaveiro e Card": 350,
  "Forma de brigadeiro": 50,
  "Topo de bolo": 450,
  "Balde de pipoca": 500,
  "Copo americano acrílico": null,
  Azulejo: null,
  "Caneca acrílica": 450,
  Almofada: 850,
};

function showMessage(message, kind = "error") {
  accountMessage.textContent = message;
  accountMessage.className =
    kind === "success" ? "account-message success" : "account-message";
  accountMessage.hidden = false;
}

function clearMessage() {
  accountMessage.textContent = "";
  accountMessage.hidden = true;
}

async function apiRequest(endpoint, options = {}) {
  let response;
  try {
    response = await fetch(endpoint, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "Não foi possível conectar à loja. Inicie o servidor com node server.js e acesse http://localhost:3000/conta.html.",
      );
    }
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      "O servidor do cadastro não foi encontrado. Inicie com node server.js e abra http://localhost:3000/conta.html (não use Live Server nem abra o arquivo diretamente).",
    );
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("O servidor retornou uma resposta inválida.");
  }

  if (!response.ok) {
    const error = new Error(result.error || "Não foi possível concluir a solicitação.");
    error.status = response.status;
    throw error;
  }

  return result;
}

function setBusy(form, busy, busyText) {
  const submitButton = form.querySelector('button[type="submit"]');
  if (busy) {
    submitButton.dataset.originalText = submitButton.textContent;
    submitButton.textContent = busyText;
    submitButton.disabled = true;
  } else {
    submitButton.textContent = submitButton.dataset.originalText || submitButton.textContent;
    submitButton.disabled = false;
  }
}

function showLoginForm() {
  authView.hidden = false;
  customerView.hidden = true;
  setAuthTab("login");
}

function setAuthTab(mode) {
  const showRegister = mode === "register";
  loginPanel.hidden = showRegister;
  registerPanel.hidden = !showRegister;
  document.getElementById("accountTitle").textContent = showRegister
    ? "Crie sua conta"
    : "Entre na sua conta";
  document.getElementById("accountDescription").textContent = showRegister
    ? "Cadastre-se para guardar seus pedidos e acompanhar seu histórico."
    : "Acesse sua conta para registrar pedidos e consultar seu histórico.";
  clearMessage();
}

function formatCurrency(cents) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function formatPhone(phone) {
  if (!phone) return "Telefone não informado";
  if (phone.length === 11) {
    return `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`;
  }
  if (phone.length === 10) {
    return `(${phone.slice(0, 2)}) ${phone.slice(2, 6)}-${phone.slice(6)}`;
  }
  return phone;
}

function readAccountCart() {
  try {
    const cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");
    if (!Array.isArray(cart)) return [];
    return cart
      .filter(
        (item) =>
          item &&
          typeof item.name === "string" &&
          Object.hasOwn(ACCOUNT_PRODUCT_PRICES, item.name),
      )
      .slice(0, 50);
  } catch (error) {
    console.error("Não foi possível carregar o carrinho salvo:", error);
    return [];
  }
}

function writeAccountCart(cart) {
  localStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify(cart.map(({ name }) => ({ name }))),
  );
}

function renderAccountCart() {
  const cart = readAccountCart();
  const cartList = document.getElementById("accountCartList");
  const totalElement = document.getElementById("accountCartTotal");
  const checkoutButton = document.getElementById("accountCheckout");
  cartList.replaceChildren();
  let totalCents = 0;
  let hasUnpricedItems = false;

  if (cart.length === 0) {
    const empty = document.createElement("p");
    empty.className = "cart-empty";
    empty.textContent = "Seu carrinho está vazio. Adicione produtos para vê-los aqui.";
    cartList.appendChild(empty);
    totalElement.textContent = formatCurrency(0);
    checkoutButton.disabled = true;
    return;
  }

  cart.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "account-cart-item";
    const details = document.createElement("div");
    const name = document.createElement("div");
    name.className = "account-cart-item-name";
    name.textContent = item.name;
    const unitPrice = ACCOUNT_PRODUCT_PRICES[item.name];
    const price = document.createElement("div");
    price.className = "account-cart-item-price";
    price.textContent =
      unitPrice === null
        ? "Preço a confirmar"
        : formatCurrency(unitPrice);
    details.append(name, price);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "account-cart-remove";
    removeButton.textContent = "Remover";
    removeButton.setAttribute("aria-label", `Remover ${item.name} do carrinho`);
    removeButton.addEventListener("click", () => {
      const updatedCart = readAccountCart();
      updatedCart.splice(index, 1);
      writeAccountCart(updatedCart);
      renderAccountCart();
    });
    row.append(details, removeButton);
    cartList.appendChild(row);

    if (unitPrice === null) {
      hasUnpricedItems = true;
    } else {
      totalCents += unitPrice;
    }
  });

  totalElement.textContent = hasUnpricedItems
    ? "A combinar"
    : formatCurrency(totalCents);
  checkoutButton.disabled = false;
}

function renderFavorites(favorites) {
  const favoritesList = document.getElementById("favoritesList");
  favoritesList.replaceChildren();

  if (favorites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "favorite-empty";
    empty.textContent =
      "Você ainda não salvou produtos. Toque em “Gostei” nos produtos da loja para encontrá-los aqui.";
    favoritesList.appendChild(empty);
    return;
  }

  favorites.forEach((favorite) => {
    const row = document.createElement("div");
    row.className = "favorite-item";
    const name = document.createElement("span");
    name.className = "favorite-item-name";
    const heart = document.createElement("span");
    heart.className = "favorite-heart";
    heart.setAttribute("aria-hidden", "true");
    heart.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"></path></svg>';
    name.append(heart, document.createTextNode(favorite.name));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "favorite-remove";
    removeButton.textContent = "Remover";
    removeButton.setAttribute(
      "aria-label",
      `Remover ${favorite.name} dos favoritos`,
    );
    removeButton.addEventListener("click", async () => {
      removeButton.disabled = true;
      try {
        await apiRequest("/api/favorites", {
          method: "DELETE",
          body: JSON.stringify({ productName: favorite.name }),
        });
        await loadCustomerFavorites();
      } catch (error) {
        showMessage(error.message);
      } finally {
        removeButton.disabled = false;
      }
    });
    row.append(name, removeButton);
    favoritesList.appendChild(row);
  });
}

async function loadCustomerFavorites() {
  const { favorites } = await apiRequest("/api/favorites");
  renderFavorites(favorites);
}

async function syncGuestFavorites() {
  let guestFavorites = [];
  try {
    const stored = JSON.parse(
      localStorage.getItem(GUEST_FAVORITES_KEY) || "[]",
    );
    if (Array.isArray(stored)) {
      guestFavorites = stored.filter(
        (name) =>
          typeof name === "string" &&
          Object.hasOwn(ACCOUNT_PRODUCT_PRICES, name),
      );
    }
  } catch (error) {
    console.error("Não foi possível ler os favoritos deste navegador:", error);
  }

  for (const productName of guestFavorites) {
    await apiRequest("/api/favorites", {
      method: "POST",
      body: JSON.stringify({ productName }),
    });
  }
  localStorage.removeItem(GUEST_FAVORITES_KEY);
}

function statusLabel(status) {
  const labels = {
    aguardando_contato: "Aguardando contato pelo WhatsApp",
    em_producao: "Em produção",
    pronto: "Pronto",
    finalizado: "Finalizado",
  };
  return labels[status] || "Status atualizado";
}

function renderOrders(orders) {
  ordersList.replaceChildren();

  if (orders.length === 0) {
    const empty = document.createElement("p");
    empty.className = "orders-empty";
    empty.textContent =
      "Você ainda não tem pedidos registrados. Seus pedidos aparecerão aqui quando finalizar uma compra.";
    ordersList.appendChild(empty);
    return;
  }

  for (const order of orders) {
    const card = document.createElement("article");
    card.className = "order-card";

    const meta = document.createElement("div");
    meta.className = "order-meta";
    const title = document.createElement("h3");
    title.textContent = `Pedido #${order.id.slice(0, 8)}`;
    const status = document.createElement("span");
    status.className = "order-status";
    status.textContent = statusLabel(order.status);
    meta.append(title, status);

    const date = document.createElement("p");
    const createdAt = new Date(order.createdAt);
    date.textContent = Number.isNaN(createdAt.getTime())
      ? ""
      : `Registrado em ${new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(createdAt)}`;

    const items = document.createElement("ul");
    for (const item of order.items) {
      const line = document.createElement("li");
      const price =
        item.unitPriceCents === null
          ? "preço a combinar"
          : formatCurrency(item.unitPriceCents);
      line.textContent = `${item.quantity}x ${item.name} — ${price}`;
      items.appendChild(line);
    }

    const total = document.createElement("p");
    total.className = "order-total";
    total.textContent =
      order.totalCents === null
        ? "Total: a combinar pelo WhatsApp"
        : `Total: ${formatCurrency(order.totalCents)}`;

    card.append(meta, date, items, total);
    ordersList.appendChild(card);
  }
}

function orderMessage(order) {
  const lines = [
    `Olá! Acabei de registrar o pedido #${order.id.slice(0, 8)} no site e gostaria de combinar os detalhes:`,
    "",
    ...order.items.map((item) => {
      const price =
        item.unitPriceCents === null
          ? "preço a confirmar"
          : formatCurrency(item.unitPriceCents);
      return `• ${item.quantity}x ${item.name} — ${price}`;
    }),
    "",
    `Total: ${order.totalCents === null ? "a combinar" : formatCurrency(order.totalCents)}`,
  ];
  return lines.join("\n");
}

function showWhatsAppLink(order) {
  const phoneNumber = "5511946202785";
  document.getElementById("whatsAppOrderLink").href =
    `https://wa.me/${phoneNumber}?text=${encodeURIComponent(orderMessage(order))}`;
  whatsAppNextStep.hidden = false;
}

async function registerPendingOrder() {
  const storedCart = sessionStorage.getItem("checkoutCart");
  if (!storedCart) {
    pendingCheckout.hidden = true;
    return;
  }

  let cart;
  try {
    cart = JSON.parse(storedCart);
  } catch {
    sessionStorage.removeItem("checkoutCart");
    pendingCheckout.hidden = true;
    showMessage("O carrinho salvo não está válido. Volte à loja e tente novamente.");
    return;
  }

  if (
    !Array.isArray(cart) ||
    cart.length === 0 ||
    cart.length > 50 ||
    cart.some((item) => !item || typeof item.name !== "string")
  ) {
    sessionStorage.removeItem("checkoutCart");
    pendingCheckout.hidden = true;
    showMessage("O carrinho salvo não está válido. Volte à loja e tente novamente.");
    return;
  }

  pendingCheckout.hidden = false;

  if (query.get("return") !== "checkout") return;

  await submitPendingOrder(cart);
}

async function submitPendingOrder(cart) {
  const checkoutButton = document.getElementById("checkoutButton");
  checkoutButton.disabled = true;
  checkoutButton.textContent = "Registrando pedido...";
  clearMessage();

  try {
    const result = await apiRequest("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        items: cart.map((item) => ({ name: item.name, quantity: 1 })),
      }),
    });
    sessionStorage.removeItem("checkoutCart");
    localStorage.removeItem(CART_STORAGE_KEY);
    pendingCheckout.hidden = true;
    showWhatsAppLink(result.order);
    renderAccountCart();
    const orderResult = await apiRequest("/api/orders");
    renderOrders(orderResult.orders);
    showMessage("Seu pedido foi salvo e já aparece no histórico da sua conta.", "success");
  } catch (error) {
    if (error.status === 401) {
      showLoginForm();
      showMessage("Sua sessão expirou. Entre novamente para registrar o pedido.");
    } else {
      showMessage(error.message);
    }
  } finally {
    checkoutButton.disabled = false;
    checkoutButton.textContent = "Registrar pedido";
  }
}

async function showCustomer(user) {
  authView.hidden = true;
  customerView.hidden = false;
  document.getElementById("accountTitle").textContent = "Minha conta";
  document.getElementById("accountDescription").textContent =
    "Acompanhe os pedidos registrados na sua conta.";
  document.getElementById("customerGreeting").textContent = `Olá, ${user.name}!`;
  document.getElementById("customerName").textContent = user.name;
  document.getElementById("customerEmail").textContent = user.email;
  document.getElementById("customerPhone").textContent = formatPhone(user.phone);

  renderAccountCart();
  await syncGuestFavorites();
  await loadCustomerFavorites();
  const { orders } = await apiRequest("/api/orders");
  renderOrders(orders);
  await registerPendingOrder();
}

showRegisterButton.addEventListener("click", () => {
  setAuthTab("register");
  document.getElementById("registerName").focus();
});
showLoginButton.addEventListener("click", () => {
  setAuthTab("login");
  document.getElementById("loginEmail").focus();
});

loginPanel.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();
  setBusy(loginPanel, true, "Entrando...");

  try {
    const formData = new FormData(loginPanel);
    const result = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    loginPanel.reset();
    await showCustomer(result.user);
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(loginPanel, false);
  }
});

registerPanel.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();
  setBusy(registerPanel, true, "Criando conta...");

  try {
    const formData = new FormData(registerPanel);
    const result = await apiRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        phone: formData.get("phone"),
        password: formData.get("password"),
      }),
    });
    registerPanel.reset();
    await showCustomer(result.user);
  } catch (error) {
    showMessage(error.message);
  } finally {
    setBusy(registerPanel, false);
  }
});

document.getElementById("checkoutButton").addEventListener("click", async () => {
  let cart;
  try {
    cart = JSON.parse(sessionStorage.getItem("checkoutCart") || "[]");
  } catch {
    showMessage("O carrinho salvo não está válido. Volte à loja e tente novamente.");
    return;
  }
  await submitPendingOrder(cart);
});

document.getElementById("accountCheckout").addEventListener("click", async () => {
  const cart = readAccountCart();
  if (cart.length === 0) {
    showMessage("Seu carrinho está vazio.");
    return;
  }

  const checkoutButton = document.getElementById("accountCheckout");
  checkoutButton.disabled = true;
  checkoutButton.textContent = "Registrando pedido...";
  clearMessage();

  try {
    const result = await apiRequest("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        items: cart.map(({ name }) => ({ name, quantity: 1 })),
      }),
    });
    localStorage.removeItem(CART_STORAGE_KEY);
    renderAccountCart();
    showWhatsAppLink(result.order);
    const { orders } = await apiRequest("/api/orders");
    renderOrders(orders);
    document.getElementById("whatsAppNextStep").scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    showMessage("Seu pedido foi salvo na sua conta. Continue pelo WhatsApp para combinar os detalhes.", "success");
  } catch (error) {
    if (error.status === 401) {
      showLoginForm();
      showMessage("Sua sessão expirou. Entre novamente para registrar o pedido.");
    } else {
      showMessage(error.message);
    }
  } finally {
    checkoutButton.textContent = "Finalizar pedido";
    renderAccountCart();
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  clearMessage();
  try {
    await apiRequest("/api/auth/logout", { method: "POST", body: "{}" });
    customerView.hidden = true;
    showLoginForm();
  } catch (error) {
    showMessage(error.message);
  }
});

async function initializeAccountPage() {
  if (query.get("return") === "checkout" && sessionStorage.getItem("checkoutCart")) {
    pendingCheckout.hidden = false;
    showMessage("Entre ou crie uma conta para salvar este pedido no seu histórico.", "success");
  }

  try {
    const result = await apiRequest("/api/auth/me");
    if (result.user) {
      await showCustomer(result.user);
      return;
    }
  } catch (error) {
    showMessage(error.message);
  }

  showLoginForm();
}

initializeAccountPage();
