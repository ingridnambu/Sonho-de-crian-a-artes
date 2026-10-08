const CART_STORAGE_KEY = "sonhoDeCrianca.cart";
const GUEST_FAVORITES_KEY = "sonhoDeCrianca.favorites";
const PRODUCT_PRICES = {
  "Caneca alça branca": 30.0,
  "Sabonete aromatizado": 2.5,
  Chaveiro: 3.0,
  "Placa de mesa": 2.5,
  Caixinha: 5.5,
  "Caneca alça colorida": 40.0,
  Card: 0.5,
  Taça: 4.5,
  Display: 5.0,
  "Caneca de chopp": 50.0,
  "Copo long drink": 3.5,
  "Chaveiro e Card": 3.5,
  "Forma de brigadeiro": 0.5,
  "Topo de bolo": 4.5,
  "Balde de pipoca": 5.0,
  "Copo americano acrílico": null,
  "Azulejo": null,
  "Caneca acrílica": 4.5,
  Almofada: 8.5,
};

function readStoredCart() {
  try {
    const storedCart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");
    if (!Array.isArray(storedCart)) return [];
    return storedCart
      .filter(
        (item) =>
          item &&
          typeof item.name === "string" &&
          Object.hasOwn(PRODUCT_PRICES, item.name),
      )
      .slice(0, 50)
      .map((item) => ({
        name: item.name,
        price: PRODUCT_PRICES[item.name],
      }));
  } catch (error) {
    console.error("Não foi possível carregar o carrinho salvo:", error);
    return [];
  }
}

const cart = readStoredCart();
const cartItemsEl = document.getElementById("cartItems");
const cartTotalEl = document.getElementById("cartTotal");
const cartCountEl = document.getElementById("cartCount");
const cartPanel = document.getElementById("cartPanel");
let checkoutInProgress = false;
let currentUser = null;
let favoriteProducts = new Set();

function addToCart(productName) {
  const price = PRODUCT_PRICES[productName] ?? null;
  cart.push({ name: productName, price });
  updateCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  updateCart();
}

function updateCart() {
  cartItemsEl.innerHTML = "";
  localStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify(cart.map(({ name }) => ({ name }))),
  );
  let total = 0;
  let hasUnpricedItems = false;

  cart.forEach((item, index) => {
    const li = document.createElement("li");
    const itemDescription = document.createElement("span");
    itemDescription.textContent =
      item.price === null
        ? `${item.name} - preço a confirmar`
        : `${item.name} - ${formatCurrency(item.price)}`;
    const removeButton = document.createElement("button");
    removeButton.className = "remove-btn";
    removeButton.type = "button";
    removeButton.textContent = "Remover";
    removeButton.setAttribute("aria-label", `Remover ${item.name} do carrinho`);
    removeButton.addEventListener("click", () => removeFromCart(index));
    li.append(itemDescription, removeButton);
    cartItemsEl.appendChild(li);
    if (item.price === null) {
      hasUnpricedItems = true;
    } else {
      total += item.price;
    }
  });

  cartTotalEl.textContent = hasUnpricedItems ? "A combinar" : formatCurrency(total);
  cartCountEl.textContent = cart.length;
}

function readGuestFavorites() {
  try {
    const stored = JSON.parse(localStorage.getItem(GUEST_FAVORITES_KEY) || "[]");
    return Array.isArray(stored)
      ? stored.filter(
          (name) => typeof name === "string" && Object.hasOwn(PRODUCT_PRICES, name),
        )
      : [];
  } catch (error) {
    console.error("Não foi possível carregar os favoritos salvos:", error);
    return [];
  }
}

function saveGuestFavorites() {
  localStorage.setItem(GUEST_FAVORITES_KEY, JSON.stringify([...favoriteProducts]));
}

function updateFavoriteButton(button, isFavorite) {
  button.classList.toggle("is-favorite", isFavorite);
  button.setAttribute("aria-pressed", String(isFavorite));
  button.setAttribute(
    "aria-label",
    isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos",
  );
  button.title = isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos";
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"></path></svg><span>Gostei</span>`;
}

function refreshFavoriteButtons() {
  document.querySelectorAll(".favorite-toggle").forEach((button) => {
    updateFavoriteButton(button, favoriteProducts.has(button.dataset.productName));
  });
}

async function toggleFavorite(productName, button) {
  const wasFavorite = favoriteProducts.has(productName);
  button.disabled = true;
  try {
    if (currentUser) {
      const response = await fetch("/api/favorites", {
        method: wasFavorite ? "DELETE" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Não foi possível atualizar seus favoritos.");
      }
    }

    if (wasFavorite) favoriteProducts.delete(productName);
    else favoriteProducts.add(productName);
    if (!currentUser) saveGuestFavorites();
    updateFavoriteButton(button, !wasFavorite);
  } catch (error) {
    console.error("Não foi possível salvar o favorito:", error);
    window.alert(error.message);
  } finally {
    button.disabled = false;
  }
}

function addFavoriteButtons() {
  document.querySelectorAll(".gallery-item").forEach((item) => {
    const productName = item.querySelector(".desc h4")?.textContent.trim();
    const description = item.querySelector(".desc");
    if (!productName || !description || !Object.hasOwn(PRODUCT_PRICES, productName)) {
      return;
    }

    const button = document.createElement("button");
    button.className = "favorite-toggle";
    button.type = "button";
    button.dataset.productName = productName;
    updateFavoriteButton(button, favoriteProducts.has(productName));
    button.addEventListener("click", () => toggleFavorite(productName, button));
    description.insertBefore(button, description.querySelector("button"));
  });
}

async function initializeCustomerFavorites() {
  favoriteProducts = new Set(readGuestFavorites());
  addFavoriteButtons();
  refreshFavoriteButtons();

  const accountLink = document.querySelector(".account-link");
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin" });
    const result = await response.json();
    currentUser = result.user;
    if (currentUser) {
      if (accountLink) accountLink.textContent = "Minha conta";
      for (const productName of favoriteProducts) {
        const saveResponse = await fetch("/api/favorites", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productName }),
        });
        if (!saveResponse.ok) {
          throw new Error("Não foi possível sincronizar seus produtos favoritos.");
        }
      }
      localStorage.removeItem(GUEST_FAVORITES_KEY);
      const favoritesResponse = await fetch("/api/favorites", {
        credentials: "same-origin",
      });
      if (!favoritesResponse.ok) {
        throw new Error("Não foi possível carregar os favoritos da sua conta.");
      }
      const favoritesResult = await favoritesResponse.json();
      favoriteProducts = new Set(favoritesResult.favorites.map(({ name }) => name));
    }
  } catch (error) {
    console.error("Não foi possível sincronizar a conta e os favoritos:", error);
  }
  refreshFavoriteButtons();
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

async function checkout() {
  if (cart.length === 0) {
    alert("Seu carrinho está vazio.");
    return;
  }
  if (checkoutInProgress) return;

  checkoutInProgress = true;
  const checkoutButton = cartPanel.querySelector('button[onclick="checkout()"]');
  checkoutButton.disabled = true;
  checkoutButton.textContent = "Registrando pedido...";
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.map((item) => ({ name: item.name, quantity: 1 })),
      }),
    });
    const result = await response.json();

    if (response.status === 401) {
      sessionStorage.setItem("checkoutCart", JSON.stringify(cart));
      window.location.href = "./conta.html?return=checkout";
      return;
    }

    if (!response.ok) {
      throw new Error(result.error || "Não foi possível registrar o pedido.");
    }

    const { order } = result;
    const lines = [
      `Olá! Acabei de registrar o pedido #${order.id.slice(0, 8)} no site e gostaria de combinar os detalhes:`,
      "",
      ...order.items.map((item) => {
        const itemPrice =
          item.unitPriceCents === null
            ? "preço a confirmar"
            : formatCurrency(item.unitPriceCents / 100);
        return `• ${item.quantity}x ${item.name} - ${itemPrice}`;
      }),
      "",
      `Total: ${order.totalCents === null ? "a combinar" : formatCurrency(order.totalCents / 100)}`,
    ];
    const numero = "5511946202785";
    cart.length = 0;
    localStorage.removeItem(CART_STORAGE_KEY);
    updateCart();
    window.location.href =
      `https://wa.me/${numero}?text=${encodeURIComponent(lines.join("\n"))}`;
  } catch (error) {
    alert(
      error instanceof TypeError
        ? "Não foi possível conectar à loja. Inicie o servidor e abra o site pelo endereço http://localhost:3000."
        : error.message,
    );
    console.error("Erro ao registrar pedido:", error);
  } finally {
    checkoutInProgress = false;
    checkoutButton.disabled = false;
    checkoutButton.textContent = "Finalizar pelo WhatsApp";
  }
}

document.getElementById("openCart").addEventListener("click", (event) => {
  cartPanel.style.display =
    cartPanel.style.display === "none" ? "block" : "none";
  event.currentTarget.setAttribute(
    "aria-expanded",
    String(cartPanel.style.display === "block"),
  );
});

updateCart();
initializeCustomerFavorites();

const productSearch = document.getElementById("productSearch");
const searchResults = document.getElementById("searchResults");
const galleryItems = [...document.querySelectorAll(".gallery-item")];
const normalizeSearchText = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

function updateGalleryResults() {
  const activeCategory =
    document.querySelector(".filter-btn.active")?.getAttribute("data-category") ||
    "todos";
  const query = normalizeSearchText(productSearch.value);
  let visibleCount = 0;

  galleryItems.forEach((item) => {
    const matchesCategory =
      activeCategory === "todos" ||
      item.getAttribute("data-category") === activeCategory;
    const searchableText = normalizeSearchText(
      `${item.querySelector(".desc h4")?.textContent || ""} ${item.querySelector("img")?.alt || ""}`,
    );
    const matchesSearch = !query || searchableText.includes(query);
    const isVisible = matchesCategory && matchesSearch;
    item.style.display = isVisible ? "" : "none";
    if (isVisible) visibleCount += 1;
  });

  searchResults.hidden = !query;
  searchResults.textContent = query
    ? visibleCount === 0
      ? "Nenhum produto encontrado. Tente outro nome ou categoria."
      : `${visibleCount} ${visibleCount === 1 ? "produto encontrado" : "produtos encontrados"}.`
    : "";
}

productSearch.addEventListener("input", updateGalleryResults);

// Filtro por categoria
document.querySelectorAll(".filter-btn").forEach((button) => {
  button.addEventListener("click", () => {
    document
      .querySelectorAll(".filter-btn")
      .forEach((btn) => {
        btn.classList.remove("active");
        btn.setAttribute("aria-pressed", "false");
      });
    button.classList.add("active");
    button.setAttribute("aria-pressed", "true");
    updateGalleryResults();
  });
});
