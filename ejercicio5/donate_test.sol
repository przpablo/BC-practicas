// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.4.22 <0.9.0;

import "remix_tests.sol";
import "remix_accounts.sol";
import "../contracts/donate.sol"; // ajusta la ruta si es necesario

contract testSuite {
    DonationPlatform platform;

    address payable recipient;   // account-1
    uint256 initCommission = 100; // 100% al recipient (0 al owner) -> evita envío con valor al owner
    uint256 initPoints = 1000;    // 1000 puntos por 1 ETH

    // ✅ Necesario para aceptar la call("", value=0) al owner (y también si luego hay comisión > 0)
    receive() external payable {}
    fallback() external payable {}

    function beforeAll() public {
        recipient = payable(TestsAccounts.getAccount(1));
        platform = new DonationPlatform(recipient, initCommission, initPoints);

        Assert.equal(platform.owner(), address(this), "Owner debe ser este contrato de test");
        Assert.equal(platform.recipient(), address(recipient), "Recipient inicial incorrecto");
        Assert.equal(platform.commissionRate(), initCommission, "Commission inicial incorrecta");
        Assert.equal(platform.pointsPerEth(), initPoints, "PointsPerEth inicial incorrecto");
    }

    function checkSuccess() public {
        Assert.ok(2 == 2, "should be true");
        Assert.greaterThan(uint(2), uint(1), "2 > 1");
        Assert.lesserThan(uint(2), uint(3), "2 < 3");
    }

    function checkSuccess2() public pure returns (bool) {
        return true;
    }

    // Constructor: recipient != 0
    function checkConstructorRecipientZeroReverts() public {
        try new DonationPlatform(address(0), 0, 1) {
            Assert.ok(false, "Debio revertir: recipient 0");
        } catch { Assert.ok(true, "OK revert recipient 0"); }
    }

    // Constructor: commissionRate <= 100
    function checkConstructorCommissionAbove100Reverts() public {
        try new DonationPlatform(recipient, 101, 1) {
            Assert.ok(false, "Debio revertir: comision > 100");
        } catch { Assert.ok(true, "OK revert comision > 100"); }
    }

    /// Donación vía donate()
    /// #value: 1000000000000000000   (1 ether)
    function testDonateBasic() public payable {
        uint256 amount = 1 ether;

        uint256 recipientBefore = recipient.balance;
        uint256 donatedBefore = platform.getTotalDonated(address(this));
        uint256 pointsBefore = platform.getPoints(address(this));

        platform.donate{value: amount}();

        // commissionRate = 100 => 100% al recipient, 0% al owner
        Assert.equal(recipient.balance, recipientBefore + amount, "Recipient no recibio el 100%");

        Assert.equal(
            platform.getTotalDonated(address(this)),
            donatedBefore + amount,
            "Total donado no actualizado"
        );

        uint256 expectedPoints = (amount * platform.pointsPerEth()) / 1e18;
        Assert.equal(
            platform.getPoints(address(this)),
            pointsBefore + expectedPoints,
            "Puntos no actualizados"
        );

        Assert.equal(address(platform).balance, uint256(0), "La plataforma no debe acumular ETH");
    }

    /// Donación vía receive() (ETH directo)
    /// #value: 500000000000000000   (0.5 ether)
    function testReceiveBasic() public payable {
        uint256 amount = 0.5 ether;

        uint256 recipientBefore = recipient.balance;
        uint256 donatedBefore = platform.getTotalDonated(address(this));
        uint256 pointsBefore = platform.getPoints(address(this));

        (bool ok, ) = address(platform).call{value: amount}("");
        Assert.ok(ok, "Fallo al enviar ETH directo a la plataforma");

        Assert.equal(recipient.balance, recipientBefore + amount, "Recipient no recibio el 100% en receive()");

        Assert.equal(
            platform.getTotalDonated(address(this)),
            donatedBefore + amount,
            "Total donado (receive) incorrecto"
        );

        uint256 expectedPoints = (amount * platform.pointsPerEth()) / 1e18;
        Assert.equal(
            platform.getPoints(address(this)),
            pointsBefore + expectedPoints,
            "Puntos (receive) incorrectos"
        );

        Assert.equal(address(platform).balance, uint256(0), "La plataforma no debe acumular ETH");
    }

    /// donate() con value=0 debe revertir
    function testDonateZeroShouldRevert() public {
        (bool ok, ) = address(platform).call(abi.encodeWithSignature("donate()"));
        Assert.ok(!ok, "donate() sin ETH debio revertir");
    }

    /// Setters básicos (happy path)
    function testOwnerSettersBasic() public {
        platform.setCommissionRate(50);
        Assert.equal(platform.commissionRate(), uint256(50), "Commission no actualizada");

        platform.setPointsPerEth(2000);
        Assert.equal(platform.pointsPerEth(), uint256(2000), "PointsPerEth no actualizado");
    }

    /// setCommissionRate > 100 debe revertir
    function testSetCommissionRateAbove100Reverts() public {
        try platform.setCommissionRate(101) {
            Assert.ok(false, "Debio revertir comision > 100");
        } catch { Assert.ok(true, "OK revert setCommissionRate > 100"); }
    }
}
