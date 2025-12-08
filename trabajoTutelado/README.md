# DApp Tickets

Aplicación descentralizada (DApp) para la gestión, emisión y validación de tickets utilizando tecnología blockchain. Permite crear un sistema seguro, transparente y no falsificable para la compra y uso de entradas mediante contratos inteligentes.

## Requisitos previos

- Node.js (v16 o superior)
- npm
- Navegador con extensión MetaMask
- Red de pruebas blockchain (por ejemplo, Sepolia)

## Instalación

```bash
cd dapp_tickets
npm install
```

## Ejecución del docker

Lo hacemos igual que en el tutorial de la Práctica 2:
```bash
docker run -d --name ipfs_host -v $PWD:/export -v $PWD:/data/ipfs -p
4001:4001 -p 4001:4001/udp -p 127.0.0.1:8080:8080 -p
127.0.0.1:5001:5001 ipfs/kubo

docker exec ipfs_host ipfs config --json API.HTTPHeaders.AccessControl-Allow-Origin '["http://0.0.0.0:5001", "http://localhost:3000",
"http://127.0.0.1:5001", "https://webui.ipfs.io"]'
```

## Ejecución
Solo la primera vez
```bash
npm install -g serve 
```

```bash
serve -l 3000
```

## Uso

Ya estará desplegado en:
- Local:    http://localhost:3000
- Network:  http://192.168.56.1:3000

