// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DonationPlatform {

    address public owner;            
    address public recipient;        
    uint256 public commissionRate;   // porcentaje para recipient (0–100)
    uint256 public imagePrice;       // precio minimo para obtener la imagen

    // --- Imagen de cada usuario (hash/CID de IPFS) ---
    mapping(address => string) public userFiles;

    // --- Eventos ---
    event DonationReceived(
        address indexed donor,
        uint256 amount,       // ETH enviados
        uint256 donation,     // parte para recipient
        uint256 commission    // parte para owner
    );

    event RecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event CommissionRateUpdated(uint256 oldRate, uint256 newRate);
    event ImageAssigned(address indexed user, string fileHash);
    event ImagePriceUpdated(uint256 oldPrice, uint256 newPrice);

    uint256 private _locked;
    modifier nonReentrant() {
        require(_locked == 0, "Reentrancy blocked");
        _locked = 1;
        _;
        _locked = 0;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Solo owner");
        _;
    }

    constructor(
        address _recipient, 
        uint256 _commissionRate,
        uint256 _imagePrice         // nuevo parametro
    ) {
        require(_recipient != address(0), "Recipient invalido");
        require(_commissionRate <= 100, "Comision > 100");

        owner = msg.sender;
        recipient = _recipient;
        commissionRate = _commissionRate; 
        imagePrice = _imagePrice;
    }

    // --- Configuracion ---
    function setRecipient(address _recipient) external onlyOwner {
        require(_recipient != address(0), "Recipient invalido");
        emit RecipientUpdated(recipient, _recipient);
        recipient = _recipient;
    }

    function setCommissionRate(uint256 _rate) external onlyOwner {
        require(_rate <= 100, "Comision > 100");
        emit CommissionRateUpdated(commissionRate, _rate);
        commissionRate = _rate;
    }

    function setImagePrice(uint256 _price) external onlyOwner {
        emit ImagePriceUpdated(imagePrice, _price);
        imagePrice = _price;
    }

    // --- Parte "Ejercicio 1": guardar hash en blockchain ---
    function setFileIPFS(string calldata file) external {
        userFiles[msg.sender] = file;
        emit ImageAssigned(msg.sender, file);
    }

    // --- Donaciones ---
    function donate() external payable nonReentrant {
        require(msg.value > 0, "Debes enviar ETH para donar");
        _processDonation(msg.sender, msg.value);
    }

    function donateWithImage(string calldata fileHash) external payable nonReentrant {
        require(msg.value >= imagePrice, "No has enviado suficiente ETH");
        require(bytes(fileHash).length > 0, "Hash de archivo requerido");

        // Guardar la imagen asociada al usuario
        userFiles[msg.sender] = fileHash;
        emit ImageAssigned(msg.sender, fileHash);

        _processDonation(msg.sender, msg.value);
    }

    receive() external payable nonReentrant {
        require(msg.value > 0, "Debes enviar ETH para donar");
        _processDonation(msg.sender, msg.value);
    }

    // --- Interna ---
    function _processDonation(address donor, uint256 amount) internal {
        uint256 donation = (amount * commissionRate) / 100;
        uint256 commission = amount - donation;

        (bool ok1, ) = payable(recipient).call{value: donation}("");
        require(ok1, "Fallo en envio a recipient");

        (bool ok2, ) = payable(owner).call{value: commission}("");
        require(ok2, "Fallo en envio a owner");

        emit DonationReceived(donor, amount, donation, commission);
    }
}
