// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DonationPlatform {

    address public owner;            
    address public recipient;        
    uint256 public commissionRate; 
    uint256 public pointsPerEth;     

    // --- Estado por usuario ---
    mapping(address => uint256) public donations;   
    mapping(address => uint256) public donorPoints;

    // --- Eventos ---
    event DonationReceived(
        address indexed donor,
        uint256 amount,      
        uint256 donation,    
        uint256 commission   
    );
    
    event PointsAwarded(
        address indexed donor,
        uint256 points,      
        uint256 totalPoints  
    );

    event RecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event CommissionRateUpdated(uint256 oldRate, uint256 newRate);
    event PointsPerEthUpdated(uint256 oldValue, uint256 newValue);


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

    constructor(address _recipient, uint256 _commissionRate, uint256 _pointsPerEth) {
        require(_recipient != address(0), "Recipient invalido");
        require(_commissionRate <= 100, "Comision > 100");
        owner = msg.sender;
        recipient = _recipient;
        commissionRate = _commissionRate;
        pointsPerEth = _pointsPerEth; 
    }

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

    /// Define cuántos puntos se otorgan por 1 ETH.
    function setPointsPerEth(uint256 _pointsPerEth) external onlyOwner {
        emit PointsPerEthUpdated(pointsPerEth, _pointsPerEth);
        pointsPerEth = _pointsPerEth;
    }

    // --- Donaciones ---
    /// Donar enviando ETH y repartir automáticamente.
    function donate() external payable nonReentrant {
        require(msg.value > 0, "Debes enviar ETH para donar");
        _processDonation(msg.sender, msg.value);
    }

    /// Permite recibir ETH directamente (enviar a la direccion del contrato) y procesarlo como donacion.
    receive() external payable nonReentrant {
        require(msg.value > 0, "Debes enviar ETH para donar");
        _processDonation(msg.sender, msg.value);
    }

    function getTotalDonated(address _donor) external view returns (uint256) {
        return donations[_donor];
    }

    function getPoints(address _donor) external view returns (uint256) {
        return donorPoints[_donor];
    }

    function _processDonation(address donor, uint256 amount) internal {
        // Cálculo de reparto
        uint256 commission = (amount * commissionRate) / 100;
        uint256 donation   = amount - commission;

        // Efectos: acumular métricas
        donations[donor] += amount;

        uint256 points = (amount * pointsPerEth) / 1e18;
        if (points > 0) {
            donorPoints[donor] += points;
            emit PointsAwarded(donor, points, donorPoints[donor]);
        }

        (bool ok1, ) = payable(recipient).call{value: donation}("");
        require(ok1, "Fallo en envio a recipient");

        (bool ok2, ) = payable(owner).call{value: commission}("");
        require(ok2, "Fallo en envio a owner");

        emit DonationReceived(donor, amount, donation, commission);
    }
}
