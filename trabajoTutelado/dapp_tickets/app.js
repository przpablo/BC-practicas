// app.js
import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";
import { abis, addresses } from "./utils/index.js";

let provider;
let signer;
let currentAccount;

let eventRegistry;
let ticketNFT;
let ticketMarket;

// DOM
const logEl = document.getElementById("log");
const accountEl = document.getElementById("account");
const networkEl = document.getElementById("network");
const statusBarEl = document.getElementById("status-bar");
const statusLabelEl = document.getElementById("status-label");
const statusTextEl = document.getElementById("status-text");
const roleInfoEl = document.getElementById("role-info");

// IPFS (docker)
const IPFS_API_URL = "http://127.0.0.1:5001/api/v0";
const IPFS_GATEWAY_URL = "http://127.0.0.1:8080/ipfs";

// ----------------- helpers UI -----------------

function log(msg) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent = `[${time}] ${msg}\n` + logEl.textContent;
}

function setStatus(mode, text) {
  // mode: idle | pending | success | error
  statusBarEl.classList.remove("pending", "success", "error");
  if (mode === "pending") statusBarEl.classList.add("pending");
  if (mode === "success") statusBarEl.classList.add("success");
  if (mode === "error") statusBarEl.classList.add("error");

  const label =
    mode === "pending"
      ? "PENDING"
      : mode === "success"
      ? "OK"
      : mode === "error"
      ? "ERROR"
      : "IDLE";

  statusLabelEl.textContent = label;
  statusTextEl.textContent = text;
}

// Errores por campo (para formularios principales)
function setFieldError(fieldId, message) {
  const el = document.getElementById(`error-${fieldId}`);
  if (!el) return;
  el.textContent = message || "";
}

function clearFieldErrors(prefixes) {
  prefixes.forEach((id) => setFieldError(id, ""));
}

// ----------------- helpers contratos/IPFS -----------------

async function uploadJsonToIpfs(obj, mfsPath = null) {
  const data = JSON.stringify(obj);
  const form = new FormData();
  form.append("file", new Blob([data], { type: "application/json" }));

  let res;
  try {
    res = await fetch(`${IPFS_API_URL}/add?pin=true`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    console.error("Error de red llamando a IPFS /add:", err);
    throw new Error(
      err && err.message && err.message.includes("ERR_BLOCKED_BY_CLIENT")
        ? "El navegador está bloqueando la conexión a IPFS. Desactiva el bloqueador en localhost:3000."
        : `Error de red al llamar a IPFS: ${err.message ?? err}`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Respuesta no OK de IPFS /add:", res.status, body);
    throw new Error(
      `IPFS /add devolvió ${res.status} ${res.statusText}: ${body.slice(0, 200)}`
    );
  }

  const text = await res.text();
  const cidMatch = text.match(/"Hash":"([^"]+)"/);
  if (!cidMatch) {
    console.error("Respuesta inesperada de IPFS /add:", text);
    throw new Error("No se pudo extraer el CID de la respuesta IPFS");
  }
  const cid = cidMatch[1];

  if (mfsPath) {
    await fetch(
      `${IPFS_API_URL}/files/cp?arg=/ipfs/${cid}&arg=${encodeURIComponent(
        mfsPath
      )}&parents=true`,
      { method: "POST" }
    );
  }

  return cid;
}

function ensureContracts() {
  if (!provider || !signer || !eventRegistry || !ticketNFT || !ticketMarket) {
    log("Primero conecta la wallet antes de usar la DApp.");
    setStatus("error", "Conecta la wallet para operar con la DApp.");
    return false;
  }
  return true;
}

// ----------------- wallet -----------------

async function connectWallet() {
  try {
    if (!window.ethereum) {
      alert("Necesitas MetaMask u otra wallet Web3 compatible.");
      return;
    }

    setStatus("pending", "Solicitando conexión a la wallet...");
    provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    currentAccount = await signer.getAddress();

    const network = await provider.getNetwork();
    accountEl.textContent = currentAccount;
    networkEl.textContent = network.name || `chainId: ${network.chainId}`;

    // Instancia de contratos
    eventRegistry = new ethers.Contract(
      addresses.eventRegistry,
      abis.eventRegistry.abi,
      signer
    );
    ticketNFT = new ethers.Contract(
      addresses.ticketNFT,
      abis.ticketNFT.abi,
      signer
    );
    ticketMarket = new ethers.Contract(
      addresses.ticketMarket,
      abis.ticketMarket.abi,
      signer
    );

    log(`Wallet conectada: ${currentAccount}`);
    setStatus("success", "Wallet conectada. Lista para operar.");

    // Refrescamos panel de eventos, rol y tickets
    await refreshEventsList().catch(() => {});
    await refreshRolesAndMyTickets().catch(() => {});
  } catch (err) {
    console.error(err);
    log(`Error al conectar la wallet: ${err.message ?? err}`);
    setStatus("error", `Error al conectar la wallet: ${err.message ?? err}`);
  }
}

// ----------------- crear evento -----------------

async function handleCreateEvent() {
  try {
    if (!ensureContracts()) return;

    clearFieldErrors([
      "event-name",
      "event-date",
      "event-location",
      "event-baseprice",
      "event-maxfactor",
      "event-total",
      "event-perwallet",
      "event-cooldown",
    ]);

    const name = document.getElementById("event-name").value.trim();
    const dateStr = document.getElementById("event-date").value;
    const location = document.getElementById("event-location").value.trim();
    const basePriceEth = document.getElementById("event-baseprice").value.trim();
    const maxFactorStr = document.getElementById("event-maxfactor").value.trim();
    const totalStr = document.getElementById("event-total").value.trim();
    const perWalletStr = document.getElementById("event-perwallet").value.trim();
    const cooldownStr = document.getElementById("event-cooldown").value.trim();
    const manualCid = document.getElementById("event-cid").value.trim();

    let hasError = false;

    if (!name) {
      setFieldError("event-name", "Introduce un nombre para el evento.");
      hasError = true;
    }
    if (!dateStr) {
      setFieldError("event-date", "Selecciona una fecha y hora.");
      hasError = true;
    }
    if (!location) {
      setFieldError("event-location", "Introduce un lugar.");
      hasError = true;
    }
    if (!basePriceEth || Number(basePriceEth) <= 0) {
      setFieldError("event-baseprice", "Precio base debe ser > 0.");
      hasError = true;
    }
    if (!maxFactorStr || Number(maxFactorStr) < 100) {
      setFieldError(
        "event-maxfactor",
        "El factor de reventa mínimo es 100 (100%)."
      );
      hasError = true;
    }
    if (!totalStr || Number(totalStr) <= 0) {
      setFieldError(
        "event-total",
        "El número total de entradas debe ser mayor que 0."
      );
      hasError = true;
    }

    // Validación anti-bots: per-wallet y cooldown (0 = sin límite / sin cooldown)
    let perWalletLimit = 0;
    let cooldownSeconds = 0;

    if (perWalletStr) {
      const n = Number(perWalletStr);
      if (!Number.isInteger(n) || n < 0) {
        setFieldError(
          "event-perwallet",
          "El límite por cartera debe ser un entero >= 0 (0 = sin límite)."
        );
        hasError = true;
      } else {
        perWalletLimit = n;
      }
    }

    if (cooldownStr) {
      const n = Number(cooldownStr);
      if (!Number.isInteger(n) || n < 0) {
        setFieldError(
          "event-cooldown",
          "El cooldown debe ser un entero >= 0 (0 = sin cooldown)."
        );
        hasError = true;
      } else {
        cooldownSeconds = n;
      }
    }

    if (hasError) {
      setStatus("error", "Revisa los campos marcados en el formulario.");
      return;
    }

    // Conversión de fecha
    const ms = Date.parse(dateStr);
    if (Number.isNaN(ms)) {
      setFieldError("event-date", "Fecha/hora inválida.");
      setStatus("error", "La fecha/hora del evento no es válida.");
      return;
    }
    const dateTimestamp = Math.floor(ms / 1000);

    const basePriceWei = ethers.utils.parseEther(basePriceEth);
    const maxFactor = parseInt(maxFactorStr, 10);
    const totalTickets = ethers.BigNumber.from(totalStr);
    const perWalletLimitBn = ethers.BigNumber.from(perWalletLimit);
    const cooldownSecondsBn = ethers.BigNumber.from(cooldownSeconds);

    // Metadata a IPFS (incluimos también los campos anti-bots)
    const metadata = {
      name,
      date: dateTimestamp,
      location,
      basePriceEth,
      maxResaleFactor: maxFactor,
      totalTickets: Number(totalStr),
      maxPerWallet: perWalletLimit,
      cooldownSeconds,
      createdAt: Date.now(),
    };

    setStatus("pending", "Subiendo metadata del evento a IPFS...");
    let cid;
    if (manualCid) {
      cid = manualCid;
      log(`Usando CID manual para metadata: ${cid}`);
    } else {
      const mfsPath = `/eventos/event-${Date.now()}.json`;
      log(
        `Subiendo metadata del evento a IPFS y guardando en MFS en ${mfsPath}...`
      );
      cid = await uploadJsonToIpfs(metadata, mfsPath);
    }

    const nextIdBefore = await eventRegistry.nextEventId();

    log(
      `Creando evento on-chain (límite por cartera = ${
        perWalletLimit || "sin límite"
      }, cooldown = ${cooldownSeconds || "sin cooldown"} s)...`
    );
    setStatus("pending", "Creando evento en la blockchain...");

    // Soportamos ABI antiguo (7 parámetros) y nuevo (9 parámetros)
    const fn = eventRegistry.interface.getFunction("createEvent");
    const argCount = fn.inputs.length;

    let tx;
    if (argCount === 7) {
      // Contrato viejo: no expone límite/cooldown en createEvent
      tx = await eventRegistry.createEvent(
        name,
        ethers.BigNumber.from(dateTimestamp),
        location,
        basePriceWei,
        maxFactor,
        totalTickets,
        cid
      );
      log(
        "AVISO: createEvent() solo acepta 7 parámetros; límite por cartera y cooldown solo quedan en la metadata (no on-chain)."
      );
    } else if (argCount === 9) {
  // Contrato nuevo: metadataCid va ANTES de los límites anti-bot
      tx = await eventRegistry.createEvent(
        name,
        ethers.BigNumber.from(dateTimestamp),
        location,
        basePriceWei,
        maxFactor,
        totalTickets,
        cid,                // string metadataCid (Qm...)
        perWalletLimitBn,   // uint16 maxTicketsPerWallet
        cooldownSecondsBn   // uint32 walletCooldown
      );
    } else {
      throw new Error(
        `createEvent() tiene ${argCount} parámetros en el ABI; revisa app.js para adaptar la llamada.`
      );
    }

    await tx.wait();

    const eventId = nextIdBefore.toString();
    log(`Evento creado con ID ${eventId}, metadata CID: ${cid}`);
    log(`Metadata IPFS: ${IPFS_GATEWAY_URL}/${cid}`);
    setStatus("success", `Evento ${eventId} creado correctamente.`);

    await refreshEventsList().catch(() => {});
    await refreshRolesAndMyTickets().catch(() => {});
  } catch (err) {
    console.error(err);
    log(`Error al crear evento: ${err.message ?? err}`);
    setStatus("error", `Error al crear evento: ${err.message ?? err}`);
  }
}

// ----------------- comprar venta primaria -----------------

async function handleBuyPrimary() {
  try {
    if (!ensureContracts()) return;

    clearFieldErrors(["buy-event-id"]);

    const eventIdStr = document.getElementById("buy-event-id").value.trim();
    if (!eventIdStr) {
      setFieldError("buy-event-id", "Introduce un ID de evento.");
      setStatus("error", "Debes indicar el ID del evento.");
      return;
    }

    const eventId = ethers.BigNumber.from(eventIdStr);
    const evt = await eventRegistry.getEvent(eventId);

    // 🚩 Comprobamos existencia por organizer, no por id == 0
    const organizer = evt.organizer ?? evt[8];
    if (!organizer || organizer === ethers.constants.AddressZero) {
      setFieldError(
        "buy-event-id",
        "El evento no existe o está inactivo."
      );
      setStatus(
        "error",
        "El ID de evento no es válido o el evento está inactivo."
      );
      return;
    }

    let basePriceWei = evt.basePriceWei ?? evt.basePrice ?? evt[4];
    if (!basePriceWei || basePriceWei.isZero()) {
      log("No se pudo leer el precio base del evento.");
      setStatus(
        "error",
        "No se pudo leer el precio base del evento (revisa la ABI/contrato)."
      );
      return;
    }

    const priceEth = ethers.utils.formatEther(basePriceWei);
    log(
      `Comprando entrada para evento ${eventId.toString()} por ${priceEth} ETH...`
    );
    setStatus(
      "pending",
      `Enviando transacción de compra (${priceEth} ETH)...`
    );

    const tx = await ticketMarket.buyPrimary(eventId, {
      value: basePriceWei,
    });
    const receipt = await tx.wait();

    let tokenId = "desconocido";
    const boughtEvt = receipt.events?.find(
      (e) => e.event === "PrimaryTicketBought"
    );
    if (boughtEvt && boughtEvt.args && boughtEvt.args.tokenId) {
      tokenId = boughtEvt.args.tokenId.toString();
    }

    log(`Entrada comprada. TokenID: ${tokenId}`);
    setStatus("success", `Entrada comprada correctamente (tokenId ${tokenId}).`);

    await refreshEventsList().catch(() => {});
    await refreshRolesAndMyTickets().catch(() => {});
    } catch (err) {
    console.error(err);

    // Intentamos extraer el motivo real del revert
    const rawMsg =
      (err && err.error && err.error.message) ||
      err?.reason ||
      err?.message ||
      String(err || "");

    // 1) Cooldown: compra demasiado rápida
    if (rawMsg.includes("Debes esperar antes de volver a comprar")) {
      const nice =
        "Has intentado comprar demasiado rápido. " +
        "Debes esperar el tiempo mínimo entre compras que ha fijado el organizador para este evento.";
      log(`⏱️ ${nice}`);
      setStatus("error", nice);
      return;
    }

    // 2) Límite de tickets por cartera
    if (rawMsg.includes("Limite de tickets por cartera alcanzado")) {
      const nice =
        "Has alcanzado el número máximo de entradas permitidas para este evento con esta cartera.";
      log(`🎟️ ${nice}`);
      setStatus("error", nice);
      return;
    }

    // 3) Otros errores conocidos (opcional, pero útil)
    if (rawMsg.includes("No quedan tickets disponibles")) {
      const nice =
        "El aforo del evento ya está completo: no quedan tickets disponibles en venta primaria.";
      log(`🚫 ${nice}`);
      setStatus("error", nice);
      return;
    }

    if (rawMsg.includes("Evento ya paso")) {
      const nice =
        "El evento ya ha tenido lugar, no es posible comprar más entradas.";
      log(`📅 ${nice}`);
      setStatus("error", nice);
      return;
    }

    // Fallback genérico si no reconocemos el error
    const msg = err?.message || rawMsg || "Error desconocido al comprar entrada.";
    log(`Error al comprar entrada: ${msg}`);
    setStatus("error", `Error al comprar entrada: ${msg}`);
  }
}



// ----------------- listar ticket para reventa -----------------

async function handleListResale() {
  try {
    if (!ensureContracts()) return;

    clearFieldErrors(["resale-token-id", "resale-price"]);

    const tokenIdStr = document.getElementById("resale-token-id").value.trim();
    const priceEthStr = document.getElementById("resale-price").value.trim();

    let hasError = false;
    if (!tokenIdStr) {
      setFieldError("resale-token-id", "Introduce el tokenId del ticket.");
      hasError = true;
    }
    if (!priceEthStr || Number(priceEthStr) <= 0) {
      setFieldError("resale-price", "El precio de reventa debe ser > 0.");
      hasError = true;
    }
    if (hasError) {
      setStatus("error", "Revisa los campos del listado de reventa.");
      return;
    }

    const tokenId = ethers.BigNumber.from(tokenIdStr);
    const priceWei = ethers.utils.parseEther(priceEthStr);

    const owner = await ticketNFT.ownerOf(tokenId);
    if (owner.toLowerCase() !== currentAccount.toLowerCase()) {
      setFieldError(
        "resale-token-id",
        `El dueño on-chain del ticket es ${owner}, no la cuenta actual.`
      );
      setStatus(
        "error",
        "No puedes listar tickets que no te pertenecen en esta cuenta."
      );
      return;
    }

    const nextListingIdBefore = await ticketMarket.nextListingId();

    log(
      `Listando ticket ${tokenId.toString()} para reventa por ${priceEthStr} ETH...`
    );
    setStatus(
      "pending",
      `Creando anuncio de reventa por ${priceEthStr} ETH...`
    );

    const tx = await ticketMarket.listForResale(tokenId, priceWei);
    await tx.wait();

    const listingId = nextListingIdBefore;
    const lst = await ticketMarket.listings(listingId);

    const priceStored = lst.priceWei ?? lst.price ?? lst[2];
    const active = typeof lst.active !== "undefined" ? lst.active : lst[3];

    log(
      `Ticket listado con listingId ${listingId.toString()} a precio ${ethers.utils.formatEther(
        priceStored
      )} ETH (activo: ${active})`
    );
    setStatus(
      "success",
      `Ticket listado en reventa (listingId ${listingId.toString()}).`
    );

    await refreshEventsList().catch(() => {});
    await refreshRolesAndMyTickets().catch(() => {});
  } catch (err) {
    console.error(err);
    log(`Error al listar ticket: ${err.message ?? err}`);
    setStatus("error", `Error al listar ticket: ${err.message ?? err}`);
  }
}


// ----------------- comprar de reventa -----------------

async function handleBuyResale() {
  try {
    if (!ensureContracts()) return;

    clearFieldErrors(["resale-listing-id"]);

    const listingIdStr = document
      .getElementById("resale-listing-id")
      .value.trim();
    if (!listingIdStr) {
      setFieldError("resale-listing-id", "Introduce un listingId.");
      setStatus("error", "Debes indicar el ID del anuncio de reventa.");
      return;
    }

    const listingId = ethers.BigNumber.from(listingIdStr);
    const lst = await ticketMarket.listings(listingId);

    const seller = lst.seller ?? lst[1];
    const active = typeof lst.active !== "undefined" ? lst.active : lst[3];
    const priceWei = lst.priceWei ?? lst.price ?? lst[2];
    const tokenId = lst.tokenId ?? lst[0];

    if (!seller || seller === ethers.constants.AddressZero) {
      setFieldError("resale-listing-id", "El anuncio de reventa no existe.");
      setStatus("error", "Listing inexistente.");
      return;
    }
    if (!active) {
      setFieldError("resale-listing-id", "El anuncio está inactivo.");
      setStatus("error", "Listing inactivo.");
      return;
    }

    const priceEth = ethers.utils.formatEther(priceWei);
    log(
      `Comprando listing ${listingId.toString()} (tokenId ${tokenId.toString()}) por ${priceEth} ETH...`
    );
    setStatus(
      "pending",
      `Enviando compra de reventa (${priceEth} ETH)...`
    );

    const tx = await ticketMarket.buyFromResale(listingId, {
      value: priceWei,
    });
    const receipt = await tx.wait();

    let boughtTokenId = tokenId.toString();
    const evt = receipt.events?.find(
      (e) => e.event === "ResaleTicketBought" || e.event === "TicketSoldSecondary"
    );
    if (evt && evt.args && evt.args.tokenId) {
      boughtTokenId = evt.args.tokenId.toString();
    }

    log(`Ticket comprado en reventa. TokenID: ${boughtTokenId}`);
    setStatus(
      "success",
      `Compra en reventa completada (tokenId ${boughtTokenId}).`
    );

    await refreshEventsList().catch(() => {});
    await refreshRolesAndMyTickets().catch(() => {});
  } catch (err) {
    console.error(err);
    log(`Error al comprar en reventa: ${err.message ?? err}`);
    setStatus("error", `Error al comprar en reventa: ${err.message ?? err}`);
  }
}

// ----------------- gestión de validadores -----------------

async function handleAddValidator() {
  try {
    if (!ensureContracts()) return;

    clearFieldErrors(["validator-event-id", "validator-address"]);

    const eventIdStr = document
      .getElementById("validator-event-id")
      .value.trim();
    const addr = document
      .getElementById("validator-address")
      .value.trim();

    let hasError = false;
    if (!eventIdStr) {
      setFieldError("validator-event-id", "Introduce el ID del evento.");
      hasError = true;
    }
    if (!addr) {
      setFieldError(
        "validator-address",
        "Introduce la dirección que quieres añadir como validador."
      );
      hasError = true;
    }
    if (hasError) {
      setStatus("error", "Revisa los campos de gestión de validadores.");
      return;
    }

    const eventId = ethers.BigNumber.from(eventIdStr);
    const evt = await eventRegistry.getEvent(eventId);
    const organizer = evt.organizer ?? evt[8];

    if (!organizer || organizer === ethers.constants.AddressZero) {
      setFieldError(
        "validator-event-id",
        "El evento no existe o no tiene organizador."
      );
      setStatus("error", "Evento inexistente.");
      return;
    }

    if (organizer.toLowerCase() !== currentAccount.toLowerCase()) {
      setFieldError(
        "validator-event-id",
        `Solo el organizador (${organizer}) puede añadir validadores.`
      );
      setStatus(
        "error",
        "La cuenta actual no es organizadora del evento seleccionado."
      );
      return;
    }

    log(
      `Añadiendo ${addr} como validador del evento ${eventId.toString()}...`
    );
    setStatus("pending", "Registrando validador en la blockchain...");

    const tx = await eventRegistry.setValidator(eventId, addr, true);
    await tx.wait();

    let isVal = false;
    if (typeof eventRegistry.isValidator === "function") {
      isVal = await eventRegistry.isValidator(eventId, addr);
    }

    log(
      `Validador ${addr} añadido correctamente (isValidator = ${
        isVal ? "true" : "false"
      }).`
    );
    setStatus("success", "Validador añadido correctamente.");

    await refreshRolesAndMyTickets().catch(() => {});
  } catch (err) {
    console.error(err);
    log(`Error al añadir validador: ${err.message ?? err}`);
    setStatus("error", `Error al añadir validador: ${err.message ?? err}`);
  }
}

async function handleAddSelfAsValidator() {
  try {
    if (!ensureContracts()) return;

    clearFieldErrors(["validator-event-id"]);

    const eventIdStr = document
      .getElementById("validator-event-id")
      .value.trim();
    if (!eventIdStr) {
      setFieldError(
        "validator-event-id",
        "Introduce el ID del evento al que quieres añadirte."
      );
      setStatus("error", "Debes indicar el ID del evento.");
      return;
    }

    const eventId = ethers.BigNumber.from(eventIdStr);
    const evt = await eventRegistry.getEvent(eventId);
    const organizer = evt.organizer ?? evt[8];

    if (!organizer || organizer === ethers.constants.AddressZero) {
      setFieldError(
        "validator-event-id",
        "El evento no existe o no tiene organizador."
      );
      setStatus("error", "Evento inexistente.");
      return;
    }

    if (organizer.toLowerCase() !== currentAccount.toLowerCase()) {
      setFieldError(
        "validator-event-id",
        `La cuenta actual no es el organizador (${organizer}).`
      );
      setStatus(
        "error",
        "Solo el organizador del evento puede añadirse como validador."
      );
      return;
    }

    log(
      `Añadiendo la cuenta ${currentAccount} como validadora del evento ${eventId.toString()}...`
    );
    setStatus("pending", "Registrando validador en la blockchain...");

    const tx = await eventRegistry.setValidator(
      eventId,
      currentAccount,
      true
    );
    await tx.wait();

    let isVal = false;
    if (typeof eventRegistry.isValidator === "function") {
      isVal = await eventRegistry.isValidator(eventId, currentAccount);
    }

    log(
      `Validador añadido correctamente. isValidator = ${
        isVal ? "true" : "false (revisa ABI/contrato)"
      }.`
    );
    setStatus("success", "Te has añadido como validador del evento.");

    await refreshRolesAndMyTickets().catch(() => {});
  } catch (err) {
    console.error(err);
    log(`Error al añadirte como validador: ${err.message ?? err}`);
    setStatus(
      "error",
      `Error al añadirse como validador: ${err.message ?? err}`
    );
  }
}

// ----------------- validar ticket -----------------

async function handleValidate() {
  try {
    if (!ensureContracts()) return;

    clearFieldErrors(["validate-token-id"]);

    const tokenIdStr = document
      .getElementById("validate-token-id")
      .value.trim();
    if (!tokenIdStr) {
      setFieldError(
        "validate-token-id",
        "Introduce el tokenId del ticket a validar."
      );
      setStatus("error", "Debes indicar el tokenId del ticket.");
      return;
    }

    const tokenId = ethers.BigNumber.from(tokenIdStr);
    const eventId = await ticketNFT.ticketEvent(tokenId);

    let organizer = null;
    let isVal = false;

    try {
      const evt = await eventRegistry.getEvent(eventId);
      organizer = evt.organizer ?? evt[8];
    } catch (e) {
      console.warn("No se pudo leer getEvent en handleValidate:", e);
    }

    if (typeof eventRegistry.isValidator === "function") {
      try {
        isVal = await eventRegistry.isValidator(eventId, currentAccount);
      } catch (e) {
        console.warn("Error llamando a isValidator:", e);
      }
    }

    const isOrganizer =
      organizer &&
      organizer !== ethers.constants.AddressZero &&
      organizer.toLowerCase() === currentAccount.toLowerCase();

    if (!isOrganizer && !isVal) {
      setFieldError(
        "validate-token-id",
        `La cuenta actual no es organizadora ni validadora del evento ${eventId.toString()}.`
      );
      setStatus(
        "error",
        "Solo organizadores/validadores (o el owner on-chain) pueden validar tickets."
      );
      return;
    }

    log(
      `Marcando token ${tokenId.toString()} como usado para el evento ${eventId.toString()}...`
    );
    setStatus("pending", "Enviando validación de ticket...");

    const tx = await ticketMarket.markTicketUsed(tokenId);
    await tx.wait();

    log(`Ticket ${tokenId.toString()} marcado como usado correctamente.`);
    setStatus("success", "Ticket validado correctamente.");

    await refreshRolesAndMyTickets().catch(() => {});
  } catch (err) {
    console.error(err);
    log(`Error al validar ticket: ${err.message ?? err}`);
    setStatus("error", `Error al validar ticket: ${err.message ?? err}`);
  }
}

// ----------------- listado de eventos (columna derecha) -----------------

// ----------------- listado de eventos (columna derecha) -----------------

async function refreshEventsList() {
  try {
    if (!ensureContracts()) return;

    const listEl = document.getElementById("events-list");
    listEl.innerHTML = "<p>Cargando eventos...</p>";

    const nextId = await eventRegistry.nextEventId();
    const totalEvents = nextId.toNumber();

    if (totalEvents === 0) {
      listEl.innerHTML = "<p>No hay eventos creados todavía.</p>";
      return;
    }

    const frag = document.createDocumentFragment();

    for (let i = 0; i < totalEvents; i++) {
      let evt;
      try {
        evt = await eventRegistry.getEvent(i);
      } catch (e) {
        console.warn("No se pudo leer getEvent para id", i, e);
        continue;
      }

      const organizer = evt.organizer ?? evt[8];
      if (!organizer || organizer === ethers.constants.AddressZero) {
        continue;
      }

      const id = evt.id ?? evt[0];
      const name = evt.name ?? evt[1];
      const dateTs = (evt.date ?? evt[2]).toNumber();
      const location = evt.location ?? evt[3];
      const basePriceWei = evt.basePriceWei ?? evt.basePrice ?? evt[4];
      const maxFactor = (evt.maxResaleFactor ?? evt[5]).toString();
      const totalTickets = (evt.totalTickets ?? evt[6]).toNumber();
      const metadataCid = evt.metadataCid ?? evt[7];
      const active = evt.active ?? evt[9];

      // Campos anti-bots (opcionales)
      const perWalletRaw =
        evt.maxPerWallet ??
        evt.maxTicketsPerWallet ??
        evt.ticketsPerWallet ??
        evt[10];
      const cooldownRaw =
        evt.cooldownSeconds ??
        evt.cooldown ??
        evt.purchaseCooldownSeconds ??
        evt[11];

      let perWalletLabel = "Sin límite";
      if (perWalletRaw && perWalletRaw.toString) {
        const n = perWalletRaw.toNumber
          ? perWalletRaw.toNumber()
          : Number(perWalletRaw);
        if (n > 0) perWalletLabel = `${n} por cartera`;
      }

      let cooldownLabel = "Sin cooldown";
      if (cooldownRaw && cooldownRaw.toString) {
        const n = cooldownRaw.toNumber
          ? cooldownRaw.toNumber()
          : Number(cooldownRaw);
        if (n > 0) cooldownLabel = `${n} s entre compras`;
      }

      const minted = await ticketMarket.mintedTicketsPerEvent(id);
      const mintedNum = minted.toNumber();
      const remaining = Math.max(totalTickets - mintedNum, 0);

      const basePriceEth = ethers.utils.formatEther(basePriceWei);
      const dateStr =
        dateTs > 0
          ? new Date(dateTs * 1000).toLocaleString()
          : "sin fecha";

      const div = document.createElement("div");
      div.className = "event-item";
      div.dataset.eventId = id.toString();

      div.innerHTML = `
        <div class="event-title">[ID ${id}] ${name}</div>
        <div class="event-meta">
          <span>📍 ${location}</span>
          <span>📅 ${dateStr}</span>
        </div>
        <div class="event-meta">
          <span>💰 Base: ${basePriceEth} ETH</span>
          <span>🔁 Máx. reventa: ${maxFactor}%</span>
        </div>
        <div class="event-meta">
          <span>👛 Límite por cartera: ${perWalletLabel}</span>
          <span>⏱️ Cooldown: ${cooldownLabel}</span>
        </div>
        <div class="event-meta">
          <span>🎟️ Emitidos: ${mintedNum}/${totalTickets}</span>
          <span>✅ Restantes: ${remaining}</span>
          <span>${active ? "🟢 Activo" : "🔴 Inactivo"}</span>
        </div>
        ${
          metadataCid && metadataCid !== ""
            ? `<div class="event-link">
                 Metadatos IPFS:
                 <a href="${IPFS_GATEWAY_URL}/${metadataCid}" target="_blank" rel="noopener noreferrer">
                   ${metadataCid.slice(0, 10)}...
                 </a>
               </div>`
            : ""
        }
        <div class="event-actions">
          <button class="secondary btn-use-event">
            Usar este evento
          </button>
          <button class="btn-show-resales">
            Ver tickets de reventa
          </button>
          <div class="event-extra" id="event-extra-${id}"></div>
        </div>
      `;

      frag.appendChild(div);
    }

    listEl.innerHTML = "";
    listEl.appendChild(frag);

    // Botón "Usar este evento"
    listEl.querySelectorAll(".btn-use-event").forEach((btn) => {
      const parent = btn.closest(".event-item");
      const eventId = parent?.dataset.eventId;
      if (!eventId) return;
      btn.addEventListener("click", () => handleUseEvent(eventId));
    });

    // Nuevo botón "Ver tickets de reventa"
    listEl.querySelectorAll(".btn-show-resales").forEach((btn) => {
      const parent = btn.closest(".event-item");
      const eventId = parent?.dataset.eventId;
      if (!eventId) return;
      btn.addEventListener("click", () => handleShowResalesForEvent(eventId));
    });
  } catch (err) {
    console.error(err);
    log(`Error al actualizar listado de eventos: ${err.message ?? err}`);
  }
}

// Mostrar lista de tickets de reventa para un evento, ordenados por precio
async function handleShowResalesForEvent(eventIdStr) {
  try {
    if (!ensureContracts()) return;

    const eventId = ethers.BigNumber.from(eventIdStr);
    const extraEl = document.getElementById(`event-extra-${eventId.toString()}`);

    if (extraEl) {
      extraEl.textContent = "Cargando tickets de reventa...";
    }

    const nextListingId = await ticketMarket.nextListingId();
    const totalListings = nextListingId.toNumber();

    const resales = [];

    for (let i = 0; i < totalListings; i++) {
      const lst = await ticketMarket.listings(i);

      const seller = lst.seller ?? lst[1];
      const active = typeof lst.active !== "undefined" ? lst.active : lst[3];
      const tokenId = lst.tokenId ?? lst[0];
      const priceWei = lst.priceWei ?? lst.price ?? lst[2];

      // Si no hay seller o está inactivo, lo saltamos
      if (!seller || seller === ethers.constants.AddressZero || !active) {
        continue;
      }

      // Miramos a qué evento pertenece este token
      let evId;
      try {
        evId = await ticketNFT.ticketEvent(tokenId);
      } catch {
        continue;
      }

      if (!evId.eq(eventId)) continue;

      resales.push({
        listingId: i,
        tokenId: tokenId.toString(),
        priceWei,
      });
    }

    if (!extraEl) {
      if (!resales.length) {
        log(
          `No hay tickets en reventa para el evento ${eventId.toString()}.`
        );
      } else {
        log(
          `Encontradas ${resales.length} reventas para el evento ${eventId.toString()}.`
        );
      }
      return;
    }

    if (!resales.length) {
      extraEl.textContent =
        "No hay tickets en reventa ahora mismo para este evento.";
      log(
        `No hay listings de reventa activos para el evento ${eventId.toString()}.`
      );
      return;
    }

    // Ordenar por precio (de menor a mayor)
    resales.sort((a, b) => {
      if (a.priceWei.lt(b.priceWei)) return -1;
      if (a.priceWei.gt(b.priceWei)) return 1;
      return 0;
    });

    const lines = resales.map((r) => {
      const priceEth = ethers.utils.formatEther(r.priceWei);
      return `· Listing #${r.listingId} – Ticket #${r.tokenId} – ${priceEth} ETH`;
    });

    extraEl.innerHTML =
      "<strong>Tickets en reventa (ordenados por precio):</strong><br/>" +
      lines.join("<br/>");

    log(
      `Mostrando ${resales.length} tickets en reventa para evento ${eventId.toString()} (ordenados por precio).`
    );
  } catch (err) {
    console.error(err);
    log(`Error al obtener reventas del evento: ${err.message ?? err}`);
    setStatus("error", `Error al obtener reventas: ${err.message ?? err}`);
  }
}

// Seleccionar evento desde la columna derecha
async function handleUseEvent(eventIdStr) {
  try {
    if (!ensureContracts()) return;

    const eventId = ethers.BigNumber.from(eventIdStr);

    document.getElementById("buy-event-id").value = eventId.toString();
    document.getElementById("validator-event-id").value =
      eventId.toString();

    log(`Evento ${eventId.toString()} seleccionado para las operaciones.`);

    const evt = await eventRegistry.getEvent(eventId);
    const totalTickets = (evt.totalTickets ?? evt[6]).toNumber();

    const minted = await ticketMarket.mintedTicketsPerEvent(eventId);
    const mintedNum = minted.toNumber();
    const remaining = Math.max(totalTickets - mintedNum, 0);

    const nextListingId = await ticketMarket.nextListingId();
    const totalListings = nextListingId.toNumber();

    let activeResaleCount = 0;
    for (let i = 0; i < totalListings; i++) {
      const lst = await ticketMarket.listings(i);
      const seller = lst.seller ?? lst[1];
      const active = typeof lst.active !== "undefined" ? lst.active : lst[3];
      if (!seller || seller === ethers.constants.AddressZero || !active) {
        continue;
      }

      const tokenId = lst.tokenId ?? lst[0];
      const evId = await ticketNFT.ticketEvent(tokenId);
      if (evId.eq(eventId)) {
        activeResaleCount++;
      }
    }

    const extraEl = document.getElementById(`event-extra-${eventId.toString()}`);
    if (extraEl) {
      extraEl.textContent =
        `Venta primaria: ${remaining} tickets disponibles. ` +
        `Reventa: ${activeResaleCount} anuncios activos.`;
    }

    log(
      `Evento ${eventId.toString()}: quedan ${remaining} tickets en venta primaria y ` +
        `${activeResaleCount} listings activos en reventa.`
    );
  } catch (err) {
    console.error(err);
    log(`Error al seleccionar evento: ${err.message ?? err}`);
  }
}

// ----------------- rol + mis tickets -----------------

async function refreshRolesAndMyTickets() {
  try {
    if (!ensureContracts()) return;

    // Roles: organizador / validador
    const nextId = await eventRegistry.nextEventId();
    const totalEvents = nextId.toNumber();
    const organizerEvents = [];
    const validatorEvents = [];

    for (let i = 0; i < totalEvents; i++) {
      let evt;
      try {
        evt = await eventRegistry.getEvent(i);
      } catch {
        continue;
      }
      const organizer = evt.organizer ?? evt[8];
      if (!organizer || organizer === ethers.constants.AddressZero) continue;

      const eventId = evt.id ?? evt[0];

      if (organizer.toLowerCase() === currentAccount.toLowerCase()) {
        organizerEvents.push(eventId.toString());
      } else if (typeof eventRegistry.isValidator === "function") {
        try {
          const isVal = await eventRegistry.isValidator(
            eventId,
            currentAccount
          );
          if (isVal) validatorEvents.push(eventId.toString());
        } catch {
          // ignore
        }
      }
    }

    if (!organizerEvents.length && !validatorEvents.length) {
      roleInfoEl.textContent =
        "La cuenta conectada no es organizadora ni validadora de ningún evento.";
    } else {
      roleInfoEl.innerHTML = `
        Rol actual de <code style="font-size:0.8rem;">${currentAccount}</code>:<br/>
        ${
          organizerEvents.length
            ? `• Organizadora en eventos: ${organizerEvents.join(", ")}<br/>`
            : ""
        }
        ${
          validatorEvents.length
            ? `• Validadora en eventos: ${validatorEvents.join(", ")}`
            : ""
        }
      `;
    }

    await refreshMyTickets();
  } catch (err) {
    console.error(err);
    log(`Error al actualizar rol/tickets: ${err.message ?? err}`);
  }
}

async function refreshMyTickets() {
  try {
    if (!ensureContracts()) return;

    const listEl = document.getElementById("my-tickets-list");
    listEl.innerHTML = "<p>Cargando tickets...</p>";

    // Buscamos eventos TicketMinted donde el "to" sea la cuenta actual
    const filter = ticketNFT.filters.TicketMinted(null, null, currentAccount);
    const currentBlock = await provider.getBlockNumber();
    const events = await ticketNFT.queryFilter(filter, 0, currentBlock);

    if (!events.length) {
      listEl.innerHTML =
        "<p>No se han encontrado tickets a nombre de esta cuenta.</p>";
      return;
    }

    const frag = document.createDocumentFragment();

    for (const ev of events) {
      const tokenId = ev.args.tokenId;
      const eventId = ev.args.eventId;

      // Comprobamos que la cuenta siga siendo la dueña actual
      let owner;
      try {
        owner = await ticketNFT.ownerOf(tokenId);
      } catch {
        continue;
      }
      if (owner.toLowerCase() !== currentAccount.toLowerCase()) continue;

      const stateVal = await ticketNFT.ticketState(tokenId);

      // Soportamos tanto BigNumber como number/string
      let stateNum;
      if (stateVal && typeof stateVal.toNumber === "function") {
        stateNum = stateVal.toNumber();
      } else {
        stateNum = Number(stateVal);
      }
      const eventIdNum = eventId.toNumber();

      let stateLabel = "Desconocido";
      let stateIcon = "❓";
      if (stateNum === 1) {
        stateLabel = "Válido";
        stateIcon = "✅";
      } else if (stateNum === 2) {
        stateLabel = "Usado";
        stateIcon = "🔴";
      } else if (stateNum === 3) {
        stateLabel = "Cancelado";
        stateIcon = "⚠️";
      }

      const div = document.createElement("div");
      div.className = "ticket-item";
      div.innerHTML = `
        <div class="ticket-title">${stateIcon} Ticket #${tokenId.toString()}</div>
        <div class="ticket-meta">
          <span>Evento ID: ${eventIdNum}</span>
          <span>Estado: ${stateLabel}</span>
        </div>
        <div class="ticket-actions">
          ${
            stateNum === 1
              ? `<button class="secondary btn-ticket-resale" data-tokenid="${tokenId.toString()}">
                   Preparar reventa
                 </button>`
              : ""
          }
          ${
            stateNum === 1
              ? `<button class="btn-ticket-validate" data-tokenid="${tokenId.toString()}">
                   Preparar validación
                 </button>`
              : ""
          }
        </div>
      `;

      frag.appendChild(div);
    }

    listEl.innerHTML = "";
    if (!frag.childNodes.length) {
      listEl.innerHTML =
        "<p>No tienes tickets en estado válido a tu nombre ahora mismo.</p>";
    } else {
      listEl.appendChild(frag);
    }

    // Listeners para botones por ticket
    listEl.querySelectorAll(".btn-ticket-resale").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tokenId = btn.dataset.tokenid;
        document.getElementById("resale-token-id").value = tokenId;
        log(
          `Ticket ${tokenId} seleccionado para rellenar el formulario de reventa.`
        );
      });
    });

    listEl.querySelectorAll(".btn-ticket-validate").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tokenId = btn.dataset.tokenid;
        document.getElementById("validate-token-id").value = tokenId;
        log(
          `Ticket ${tokenId} seleccionado para rellenar el formulario de validación.`
        );
      });
    });
  } catch (err) {
    console.error(err);
    log(`Error al obtener tickets del usuario: ${err.message ?? err}`);
  }
}

// ----------------- listeners DOM -----------------

document
  .getElementById("btn-connect")
  .addEventListener("click", connectWallet);
document
  .getElementById("btn-create-event")
  .addEventListener("click", handleCreateEvent);
document
  .getElementById("btn-buy-primary")
  .addEventListener("click", handleBuyPrimary);
document
  .getElementById("btn-list-resale")
  .addEventListener("click", handleListResale);
document
  .getElementById("btn-buy-resale")
  .addEventListener("click", handleBuyResale);
document
  .getElementById("btn-add-validator")
  .addEventListener("click", handleAddValidator);
document
  .getElementById("btn-add-self-validator")
  .addEventListener("click", handleAddSelfAsValidator);
document
  .getElementById("btn-validate")
  .addEventListener("click", handleValidate);
document
  .getElementById("btn-refresh-events")
  .addEventListener("click", refreshEventsList);
document
  .getElementById("btn-refresh-my-tickets")
  .addEventListener("click", refreshRolesAndMyTickets);
