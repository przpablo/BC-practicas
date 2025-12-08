// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title NFT de tickets
/// @dev Solo el contrato TicketMarket puede mintear / marcar usados.
///      Las transferencias también están limitadas al Market.
contract TicketNFT is ERC721, Ownable {
    enum TicketState {
        None,
        Valid,
        Used,
        Cancelled
    }

    uint256 private _nextTokenId;

    // tokenId => estado
    mapping(uint256 => TicketState) public ticketState;

    // tokenId => eventId
    mapping(uint256 => uint256) public ticketEvent;

    address public eventRegistry;
    address public market; // se configura una vez vía setMarket

    event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, address indexed to);
    event TicketStateChanged(uint256 indexed tokenId, TicketState newState);
    event MarketSet(address market);

    modifier onlyMarket() {
        require(msg.sender == market, "Solo el mercado puede llamar");
        _;
    }

    constructor(address initialOwner, address _eventRegistry)
        ERC721("TicketNFT", "TNFT")
        Ownable(initialOwner)
    {
        require(_eventRegistry != address(0), "EventRegistry cero");
        eventRegistry = _eventRegistry;
    }

    /// @notice Asigna la dirección del contrato de Market (solo una vez)
    function setMarket(address _market) external onlyOwner {
        require(_market != address(0), "Market cero");
        require(market == address(0), "Market ya asignado");
        market = _market;
        emit MarketSet(_market);
    }

    /// @notice Mintea un ticket para un evento (solo Market)
    function mintTicket(address to, uint256 eventId)
        external
        onlyMarket
        returns (uint256 tokenId)
    {
        tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);
        ticketEvent[tokenId] = eventId;
        ticketState[tokenId] = TicketState.Valid;

        emit TicketMinted(tokenId, eventId, to);
        emit TicketStateChanged(tokenId, TicketState.Valid);
    }

    /// @notice Marca un ticket como usado (solo Market)
    function markUsed(uint256 tokenId) external onlyMarket {
        require(_ownerOf(tokenId) != address(0), "Token no existe");
        require(
            ticketState[tokenId] == TicketState.Valid,
            "Ticket no valido para marcar como usado"
        );

        ticketState[tokenId] = TicketState.Used;
        emit TicketStateChanged(tokenId, TicketState.Used);
    }

    /// @dev Hook nuevo en OZ v5 para autorizar transferencias.
    ///      Solo el Market puede mover los tokens.
    function _isAuthorized(
        address /*owner*/,
        address spender,
        uint256 /*tokenId*/
    ) internal view override returns (bool) {
        return spender == market;
    }
}
