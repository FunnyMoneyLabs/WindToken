![Img](logo.jpg)

# Funny Money Labs  | Wind Token

A BoilerPlate Template Project To Start Solidity Development With Hardhat and Typescript.
All you have to do is create a new repository from the template and start coding your smart contracts.


## Project Structure

```text
.
├── contracts
│   ├── BasicERC1155.sol
│   ├── BasicERC20.sol
│   └── BasicERC721.sol
├── deploy
│   ├── Deploy_BasicERC1155.ts
│   ├── Deploy_BasicERC20.ts
│   └── Deploy_BasicERC721.ts
├── deployments
├── hardhat.config.ts
├── tasks
│   ├── erc1155
│   ├── erc20
│   ├── erc721
│   └── utils
└── test
    ├── BasicERC1155.ts
    ├── BasicERC20.ts
    └── BasicERC721.ts
```

## Supported Networks

-   Hardhat Network (localhost)
-   Sonic

## Usage

### Setup

#### 1. Install Dependencies

```shell
npm install
```

#### 2. Compile Contracts

```shell
npm run compile
```

#### 3. Environment Setup

Create `.env` file and add your environment variables. You can use `.env.example` as a template.

If you are going to use public network, make sure you include the right RPC provider for that network.

Make sure you include either `MNEMONIC` or `PRIVATE_KEY` in your `.env` file.

### Example Flow - Deploy ERC721 Token

> This is an example flow to deploy an ERC721 token to a public network and interact with it.

#### 1. Deploy BasicERC721 Contract

```shell
hh deploy --network sepolia --tags BasicERC721
```

#### 2. Verify Contract

```shell
hh --network sepolia etherscan-verify
```

#### 3. Interact With Contract - Mint

```shell
hh erc721-mint \
 --contract 0x77337983A7D1699FaF51a5f43b9907fB7B614097 \
 --recipient 0x73faDd7E476a9Bc2dA6D1512A528366A3E50c3cF \
 --network sepolia
```

---

### Testing

#### Run Tests

```shell
npm run test
```

#### Run Coverage

```shell
npm run coverage
```

---

### Project Hygiene

#### Prettier - Non Solidity Files

```shell
npm run format:check
npm run format:write
```

#### Lint - Non Solidity Files

```shell
npm run lint:check
npm run lint:fix
```

#### Prettier - Solidity

```shell
npm run sol:format:check
npm run sol:format:write
```

#### Solhint - Enforcing styles and security best practices

```shell
npm run solhint
```

<br>
