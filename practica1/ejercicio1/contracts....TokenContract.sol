// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract TokenContract {
    
    address public owner;

    struct Receivers {
        string name;
        uint256 tokens;
    }

    mapping(address => Receivers) public users;

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    constructor() {
        owner = msg.sender;
        users[owner].name = "Bob";
        users[owner].tokens = 100;
    }

    function double(uint _value) public pure returns (uint) {
        return _value * 2;
    }

    function register(string memory _name) public {
        users[msg.sender].name = _name;
    }

    function giveToken(address _receiver, uint256 _amount) onlyOwner public {
        require(users[owner].tokens >= _amount);
        users[owner].tokens -= _amount;
        users[_receiver].tokens += _amount;
    }

    // Cualquiera puede comprar tokens del owner pagando 5 ether por token
    function buyToken(uint256 _amount) public payable {
        require(_amount > 0, "Cantidad de tokens invalida");
        uint256 price = _amount * 5 ether;
        require(msg.value == price, "Debes enviar exactamente 5 ETH por token");
        require(users[owner].tokens >= _amount, "El owner no tiene suficientes tokens");

        // transferimos tokens del owner al comprador
        users[owner].tokens -= _amount;
        users[msg.sender].tokens += _amount;

        // (opcional) reenviar el ether al owner en vez de dejarlo en el contrato:
        payable(owner).transfer(msg.value);
    }

    // Para ingresar ETH manualmente al contrato si quieres
    receive() external payable {}

    function saldoContrato() external view returns (uint256) {
        return address(this).balance;
    }
}
