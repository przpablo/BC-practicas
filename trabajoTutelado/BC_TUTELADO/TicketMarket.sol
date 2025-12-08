// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./EventRegistry.sol";
import "./TicketNFT.sol";

/// @title Mercado de tickets: venta primaria + reventa segura
/// @notice Gestiona compra primaria, reventa con límite de precio y validación de acceso.
contract TicketMarket is Ownable, ReentrancyGuard {
    EventRegistry public eventRegistry;
    TicketNFT public ticketNFT;

    struct Listing {
        uint256 tokenId;
        address seller;
        uint256 priceWei;
        bool active;
    }

    struct BuyerState {
        uint256 bought;   // nº de tickets primarios comprados para ese evento
        uint64 lastBuyTs; // timestamp de la última compra primaria
    }

    uint256 public nextListingId;
    mapping(uint256 => Listing) public listings;

    // eventId => nº de tickets emitidos
    mapping(uint256 => uint256) public mintedTicketsPerEvent;

    // eventId => wallet => estado anti-bots
    mapping(uint256 => mapping(address => BuyerState)) public buyerState;

    event PrimaryTicketBought(
        uint256 indexed tokenId,
        uint256 indexed eventId,
        address indexed buyer,
        uint256 priceWei
    );

    event TicketListed(
        uint256 indexed listingId,
        uint256 indexed tokenId,
        address indexed seller,
        uint256 priceWei
    );

    event ResaleTicketBought(
        uint256 indexed listingId,
        uint256 indexed tokenId,
        address indexed buyer,
        uint256 priceWei
    );

    event TicketUsed(
        uint256 indexed tokenId,
        uint256 indexed eventId,
        address indexed validator
    );

    constructor(
        address _eventRegistry,
        address _ticketNFT,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_eventRegistry != address(0), "EventRegistry cero");
        require(_ticketNFT != address(0), "TicketNFT cero");
        eventRegistry = EventRegistry(_eventRegistry);
        ticketNFT = TicketNFT(_ticketNFT);
    }

    // ========= VENTA PRIMARIA =========

    /// @notice Compra un ticket en venta primaria.
    /// @dev Aplica límites de stock, estado del evento, fecha,
    ///      y también limite por cartera + cooldown configurados por el organizador.
    function buyPrimary(uint256 eventId) external payable nonReentrant {
        EventRegistry.EventData memory evt = eventRegistry.getEvent(eventId);
        require(evt.organizer != address(0), "Evento inexistente");
        require(evt.active, "Evento inactivo");
        require(block.timestamp < evt.date, "Evento ya paso");
        require(msg.value == evt.basePriceWei, "Precio incorrecto");

        // Limitar número máximo de tickets emitidos (aforo total)
        require(
            mintedTicketsPerEvent[eventId] < evt.totalTickets,
            "No quedan tickets disponibles"
        );

        // ---- Anti-bots por cartera ----
        BuyerState storage st = buyerState[eventId][msg.sender];

        // 1) Limite de tickets por cartera (si > 0)
        if (evt.maxTicketsPerWallet > 0) {
            require(
                st.bought + 1 <= evt.maxTicketsPerWallet,
                "Limite de tickets por cartera alcanzado"
            );
        }

        // 2) Cooldown entre compras (si > 0)
        if (evt.walletCooldown > 0 && st.lastBuyTs != 0) {
            require(
                block.timestamp >= st.lastBuyTs + evt.walletCooldown,
                "Debes esperar antes de volver a comprar"
            );
        }

        // Si pasa los checks, emitimos el ticket
        mintedTicketsPerEvent[eventId]++;

        uint256 tokenId = ticketNFT.mintTicket(msg.sender, eventId);

        // Actualizamos estado anti-bots
        st.bought += 1;
        st.lastBuyTs = uint64(block.timestamp);

        // En un sistema real se enviarían fondos al organizer, etc.
        // payable(evt.organizer).transfer(msg.value);

        emit PrimaryTicketBought(tokenId, eventId, msg.sender, msg.value);
    }
    
    // ========= REVENTA =========

    /// @notice Pone un ticket en reventa.
    /// @dev Solo el dueño actual del NFT puede listar. El precio está limitado por
    ///      basePriceWei * maxResaleFactor / 100 y el evento debe estar activo y no pasado.
    function listForResale(uint256 tokenId, uint256 priceWei) external nonReentrant {
        require(ticketNFT.ownerOf(tokenId) == msg.sender, "No eres el dueno del ticket");
        require(
            ticketNFT.ticketState(tokenId) == TicketNFT.TicketState.Valid,
            "Ticket no valido"
        );
        require(priceWei > 0, "Precio debe ser > 0");

        uint256 eventId = ticketNFT.ticketEvent(tokenId);
        EventRegistry.EventData memory evt = eventRegistry.getEvent(eventId);
        require(evt.organizer != address(0), "Evento inexistente");
        require(evt.active, "Evento inactivo");
        require(block.timestamp < evt.date, "Evento ya paso");

        // Max price = basePrice * maxResaleFactor / 100
        uint256 maxPrice = (evt.basePriceWei * evt.maxResaleFactor) / 100;
        require(priceWei <= maxPrice, "Sobrepasa el maximo de reventa");

        // Transferimos el ticket al Market (escrow)
        ticketNFT.transferFrom(msg.sender, address(this), tokenId);

        uint256 listingId = nextListingId++;
        listings[listingId] = Listing({
            tokenId: tokenId,
            seller: msg.sender,
            priceWei: priceWei,
            active: true
        });

        emit TicketListed(listingId, tokenId, msg.sender, priceWei);
    }

    /// @notice Compra un ticket de reventa.
    /// @dev Valida que la listing exista, esté activa y que el evento siga activo y no pasado.
    function buyFromResale(uint256 listingId) external payable nonReentrant {
        Listing storage lst = listings[listingId];
        require(lst.active, "Listing inactiva");
        require(lst.seller != address(0), "Listing inexistente");
        require(msg.value == lst.priceWei, "Precio incorrecto");

        uint256 eventId = ticketNFT.ticketEvent(lst.tokenId);
        EventRegistry.EventData memory evt = eventRegistry.getEvent(eventId);
        require(evt.organizer != address(0), "Evento inexistente");
        require(evt.active, "Evento inactivo");
        require(block.timestamp < evt.date, "Evento ya paso");

        lst.active = false;

        // Pagamos al vendedor
        payable(lst.seller).transfer(msg.value);

        // Transferimos el ticket al comprador
        ticketNFT.transferFrom(address(this), msg.sender, lst.tokenId);

        emit ResaleTicketBought(listingId, lst.tokenId, msg.sender, msg.value);
    }

    // ========= VALIDACION EN ACCESO =========

    /// @notice Marca un ticket como usado en acceso.
    /// @dev Solo organizador/validador del evento o el owner global.
    function markTicketUsed(uint256 tokenId) external nonReentrant {
        uint256 eventId = ticketNFT.ticketEvent(tokenId);
        EventRegistry.EventData memory evt = eventRegistry.getEvent(eventId);
        require(evt.organizer != address(0), "Evento inexistente");

        // Permitimos validar a:
        //  - organizador del evento
        //  - cualquier validador autorizado en EventRegistry
        //  - owner global del contrato (fallback de emergencia)
        bool autorizado = (msg.sender == evt.organizer) ||
            eventRegistry.isValidator(eventId, msg.sender) ||
            (msg.sender == owner());

        require(autorizado, "No autorizado para validar");

        ticketNFT.markUsed(tokenId);
        emit TicketUsed(tokenId, eventId, msg.sender);
    }
}
