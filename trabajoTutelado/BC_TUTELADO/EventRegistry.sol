// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Registro de eventos para el sistema de tickets
/// @notice Gestiona la configuración de eventos (precio base, límites de reventa,
///         metadatos en IPFS, organizador) y los validadores autorizados.
contract EventRegistry is Ownable {
    struct EventData {
        uint256 id;
        string name;
        uint256 date;          // timestamp del evento (segundos desde epoch)
        string location;
        uint256 basePriceWei;  // precio base en wei
        uint8 maxResaleFactor; // 130 => 130% del precio base
        uint256 totalTickets;  // nº total de entradas emitibles
        string metadataCid;    // JSON/IPFS con más info
        address organizer;
        bool active;
        uint16 maxTicketsPerWallet; // 0 = sin limite por cartera (venta primaria)
        uint32 walletCooldown;      // segundos entre compras (0 = sin cooldown)
    }

    uint256 public nextEventId;

    // eventId => datos del evento
    mapping(uint256 => EventData) public events;

    // eventId => address => isValidator
    mapping(uint256 => mapping(address => bool)) private _validators;

    event EventCreated(
        uint256 indexed eventId,
        address indexed organizer,
        string name,
        uint256 date,
        string location,
        uint256 basePriceWei,
        uint8 maxResaleFactor,
        uint256 totalTickets,
        string metadataCid,
        uint16 maxTicketsPerWallet,
        uint32 walletCooldown
    );

    event EventStatusChanged(uint256 indexed eventId, bool active);

    event ValidatorSet(uint256 indexed eventId, address indexed validator, bool active);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Crea un nuevo evento.
    /// @dev La fecha se pasa como timestamp en segundos. En la UI usaremos un
    ///      date/datetime picker y convertiremos allí.
    function createEvent(
        string memory name,
        uint256 date,
        string memory location,
        uint256 basePriceWei,
        uint8 maxResaleFactor,
        uint256 totalTickets,
        string memory metadataCid,
        uint16 maxTicketsPerWallet,
        uint32 walletCooldown
    ) external returns (uint256 eventId) {
        require(bytes(name).length > 0, "Nombre obligatorio");
        require(basePriceWei > 0, "Precio base > 0");
        require(totalTickets > 0, "Total tickets > 0");
        require(maxResaleFactor >= 100, "Factor de reventa minimo 100%");

        // Opcional: si se pone limite por cartera, que no sea mayor que el total
        if (maxTicketsPerWallet > 0) {
            require(
                maxTicketsPerWallet <= totalTickets,
                "Limite por cartera > total"
            );
        }

        eventId = nextEventId++;

        events[eventId] = EventData({
            id: eventId,
            name: name,
            date: date,
            location: location,
            basePriceWei: basePriceWei,
            maxResaleFactor: maxResaleFactor,
            totalTickets: totalTickets,
            metadataCid: metadataCid,
            organizer: msg.sender,
            active: true,
            maxTicketsPerWallet: maxTicketsPerWallet,
            walletCooldown: walletCooldown
        });

        emit EventCreated(
            eventId,
            msg.sender,
            name,
            date,
            location,
            basePriceWei,
            maxResaleFactor,
            totalTickets,
            metadataCid,
            maxTicketsPerWallet,
            walletCooldown
        );
    }

    /// @notice Devuelve todos los datos de un evento.
    function getEvent(uint256 eventId)
        external
        view
        returns (EventData memory)
    {
        return events[eventId];
    }

    /// @notice Activa o desactiva un evento (soft-delete).
    function setEventActive(uint256 eventId, bool active) external {
        EventData storage evt = events[eventId];
        require(evt.organizer != address(0), "Evento inexistente");
        require(
            msg.sender == evt.organizer || msg.sender == owner(),
            "Solo organizer u owner"
        );

        evt.active = active;
        emit EventStatusChanged(eventId, active);
    }

    /// @notice Marca o desmarca una cuenta como validador del evento.
    function setValidator(
        uint256 eventId,
        address validator,
        bool isActive
    ) external {
        EventData storage evt = events[eventId];
        require(evt.organizer != address(0), "Evento inexistente");
        require(
            msg.sender == evt.organizer || msg.sender == owner(),
            "Solo organizer u owner"
        );
        require(validator != address(0), "Validador no valido");

        _validators[eventId][validator] = isActive;
        emit ValidatorSet(eventId, validator, isActive);
    }

    /// @notice Comprueba si una dirección es validador para un evento.
    function isValidator(uint256 eventId, address account)
        external
        view
        returns (bool)
    {
        return _validators[eventId][account];
    }

    /// @notice Comprueba si una dirección es organizador o validador para un evento.
    function isOrganizerOrValidator(uint256 eventId, address account)
        external
        view
        returns (bool)
    {
        EventData storage evt = events[eventId];
        if (evt.organizer == address(0)) return false;
        if (account == evt.organizer) return true;
        return _validators[eventId][account];
    }
}
