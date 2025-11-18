import React, { useEffect, useState } from "react";
import "./App.css";
import { ethers } from "ethers";
import { create as createIpfsClient } from "kubo-rpc-client";

// Dirección del contrato DonationPlatform desplegado (el donate.sol nuevo)
const DONATE_CONTRACT_ADDRESS = "0xB6CA37e7c6114d4E661b425A5DCbcFd334dB7b97";

// ABI mínima que necesitamos del contrato DonationPlatform
const DONATE_ABI = [
  "function donateWithImage(string fileHash) external payable",
  "function commissionRate() view returns (uint256)",
  "function imagePrice() view returns (uint256)",
  "function recipient() view returns (address)",
];

// Cliente de IPFS (daemon local de Kubo)
const ipfs = createIpfsClient({
  url: "http://127.0.0.1:5001/api/v0",
});

function App() {
  const [walletAddress, setWalletAddress] = useState("");
  const [status, setStatus] = useState("");
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [priceEth, setPriceEth] = useState("0.01");
  const [images, setImages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isBuying, setIsBuying] = useState(false);

  const [donationPercent, setDonationPercent] = useState(10);
  const [donationAddress, setDonationAddress] = useState(
    "0x9ca138540fd77eaf4e82bc51eed9b81c647a5c2b"
  );
  const [contractPriceEth, setContractPriceEth] = useState(null);

  // Leer commissionRate, recipient e imagePrice del contrato
  const loadContractInfo = async (provider) => {
    try {
      const contract = new ethers.Contract(
        DONATE_CONTRACT_ADDRESS,
        DONATE_ABI,
        provider
      );

      const [rateBN, recipient, imagePriceBN] = await Promise.all([
        contract.commissionRate(),
        contract.recipient(),
        contract.imagePrice(),
      ]);

      const rate = Number(rateBN.toString());
      setDonationPercent(rate);
      setDonationAddress(recipient);

      const priceEthFromContract = ethers.utils.formatEther(imagePriceBN);
      setContractPriceEth(priceEthFromContract);
      // Prefijamos el input de precio con el valor mínimo del contrato
      setPriceEth(priceEthFromContract);
    } catch (err) {
      console.error("Error leyendo datos del contrato:", err);
      setStatus(
        "No se pudieron leer commissionRate/imagePrice/recipient. Revisa la dirección del contrato o la red en MetaMask."
      );
    }
  };

  // Conectar MetaMask
  const connectWallet = async () => {
    try {
      if (!window.ethereum) {
        setStatus("Necesitas MetaMask instalada.");
        return;
      }
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      setWalletAddress(accounts[0]);
      setStatus("Billetera conectada correctamente.");

      await loadContractInfo(provider);
    } catch (err) {
      console.error(err);
      setStatus("Error al conectar la billetera.");
    }
  };

  // Al cargar la página intentamos precargar datos del contrato (si hay MetaMask)
  useEffect(() => {
    async function init() {
      if (!window.ethereum) return;
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      try {
        await loadContractInfo(provider);
      } catch (err) {
        console.error(err);
      }
    }
    init();
  }, []);

  // Subir imagen a IPFS y añadirla a la galería local
  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) {
      setStatus("Selecciona un fichero de imagen.");
      return;
    }
    if (!title.trim()) {
      setStatus("Ponle un título a la imagen.");
      return;
    }

    try {
      setIsUploading(true);
      setStatus("Subiendo imagen a IPFS...");

      const added = await ipfs.add(file);
      const cid = added.cid.toString();
      const url = `http://127.0.0.1:8080/ipfs/${cid}`;
      // Copiar al MFS para que aparezca en la pestaña "ARCHIVOS" del WebUI
      await ipfs.files.cp(`/ipfs/${cid}`, `/${cid}`);

      const newImage = {
        id: images.length + 1,
        title,
        cid,
        url,
        priceEth,
      };

      setImages((prev) => [...prev, newImage]);
      setStatus(`Imagen subida. CID: ${cid}`);
      setFile(null);
      setTitle("");
      // dejamos priceEth como está por si quiere subir más con el mismo precio
    } catch (err) {
      console.error(err);
      setStatus("Error al subir la imagen a IPFS.");
    } finally {
      setIsUploading(false);
    }
  };

  // Comprar una imagen usando donateWithImage(fileHash)
  const handleBuy = async (image) => {
    try {
      if (!window.ethereum) {
        setStatus("Necesitas MetaMask para comprar.");
        return;
      }

      setIsBuying(true);
      setStatus("Enviando transacción al contrato DonationPlatform...");
      
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      setWalletAddress(accounts[0]);
      const signer = provider.getSigner();

      // Comprobar que no se envía menos de lo que exige imagePrice
      if (
        contractPriceEth &&
        parseFloat(image.priceEth) < parseFloat(contractPriceEth)
      ) {
        setStatus(
          `El precio que has puesto (${image.priceEth} ETH) es menor que el precio mínimo configurado en el contrato (${contractPriceEth} ETH).`
        );
        setIsBuying(false);
        return;
      }

      const donateContract = new ethers.Contract(
        DONATE_CONTRACT_ADDRESS,
        DONATE_ABI,
        signer
      );

      const value = ethers.utils.parseEther(image.priceEth);

      // Llamada al método donateWithImage(string fileHash)
      const tx = await donateContract.donateWithImage(image.cid, { value });
      await tx.wait();

      const total = Number(image.priceEth);
      const donated = (total * donationPercent) / 100;
      const ownerShare = total - donated;

      setStatus(
        `Compra realizada ✅ Has pagado ${image.priceEth} ETH: ` +
          `${donated.toFixed(4)} ETH (${donationPercent}%) se donan a ${donationAddress} ` +
          `y ${ownerShare.toFixed(4)} ETH (${(100 - donationPercent).toFixed(
            0
          )}%) van al propietario (owner) del contrato.`
      );
    } catch (err) {
      console.error(err);
      setStatus(
        "Error al realizar la compra (transacción cancelada, red incorrecta o contrato mal configurado)."
      );
    } finally {
      setIsBuying(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>DApp de Imágenes Solidarias (IPFS + DonationPlatform)</h1>

        {/* Conexión de cartera */}
        <div className="wallet-section">
          <button onClick={connectWallet}>
            {walletAddress ? "Billetera conectada" : "Conectar MetaMask"}
          </button>
          {walletAddress && (
            <p className="wallet-address">
              Conectado como: <span>{walletAddress}</span>
            </p>
          )}
        </div>

        {/* Info leída del contrato */}
        <section className="contract-info">
          <h2>Datos del contrato DonationPlatform</h2>
          <p>
            Dirección del contrato: <code>{DONATE_CONTRACT_ADDRESS}</code>
          </p>
          <p>
            Dirección que recibe las donaciones (recipient):{" "}
            <code>{donationAddress}</code>
          </p>
          <p>
            Porcentaje donado (commissionRate):{" "}
            <strong>{donationPercent}%</strong>
          </p>
          {contractPriceEth && (
            <p>
              Precio mínimo configurado en el contrato (imagePrice):{" "}
              <strong>{contractPriceEth} ETH</strong>
            </p>
          )}
        </section>

        {/* Formulario para subir imagen a IPFS */}
        <section className="upload-section">
          <h2>1. Subir nueva imagen a IPFS</h2>
          <form onSubmit={handleUpload} className="upload-form">
            <label>
              Título de la imagen:
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej: Atardecer solidario"
              />
            </label>

            <label>
              Precio (en ETH):
              <input
                type="number"
                step="0.001"
                min="0"
                value={priceEth}
                onChange={(e) => setPriceEth(e.target.value)}
              />
            </label>

            <label>
              Fichero de imagen:
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files[0] || null)}
              />
            </label>

            <button type="submit" disabled={isUploading}>
              {isUploading ? "Subiendo..." : "Subir a IPFS y añadir a la galería"}
            </button>
          </form>
          <p className="help-text">
            La imagen se almacena en IPFS y guardamos el CID en la galería
            local. Al comprarla, llamamos a{" "}
            <code>donateWithImage(fileHash)</code> del contrato{" "}
            <code>DonationPlatform</code>, que reparte el importe: una parte va
            a <code>recipient</code> como donación y el resto al{" "}
            <code>owner</code> (plataforma / propietario de la imagen).
          </p>
        </section>

        {/* Galería de imágenes en venta */}
        <section className="gallery-section">
          <h2>2. Galería de imágenes en venta</h2>
          {images.length === 0 ? (
            <p>Aún no hay imágenes. Sube alguna en el formulario de arriba.</p>
          ) : (
            <div className="gallery-grid">
              {images.map((img) => {
                const total = Number(img.priceEth);
                const donated = (total * donationPercent) / 100;
                const ownerShare = total - donated;
                return (
                  <div key={img.id} className="image-card">
                    <img
                      src={img.url}
                      alt={img.title}
                      className="image-preview"
                    />
                    <h3>{img.title}</h3>
                    <p className="cid">
                      CID: <code>{img.cid}</code>
                    </p>
                    <p>
                      Precio: <strong>{img.priceEth} ETH</strong>
                    </p>
                    <p className="split">
                      De cada compra:
                      <br />
                      • {donated.toFixed(4)} ETH ({donationPercent}%) se envían
                      como donación a <code>{donationAddress}</code>
                      <br />
                      • {ownerShare.toFixed(4)} ETH (
                      {(100 - donationPercent).toFixed(0)}%) van al propietario
                      (owner) del contrato
                    </p>
                    <button onClick={() => handleBuy(img)} disabled={isBuying}>
                      {isBuying ? "Procesando compra..." : "Comprar imagen"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Zona de estado / mensajes */}
        {status && <div className="status-box">{status}</div>}
      </header>
    </div>
  );
}

export default App;
