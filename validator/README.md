# exSat validator

Validators contribute trust and security to exSat, they will check and validate the data provided by mining pools separately and use a PoS model to achieve consensus to the data.

Staking of BTC and XSAT tokens is required to be qualified as validators, thereby aligning their interests with the network’s security and reliability.

## Setup

### Prerequisites

- Node.js (>= 20.x)
- npm (>= 10.x)

### Installation

1. Clone the repository:
    ```sh
    git clone https://github.com/exsat-network/clients.git
    cd clients/validator
    ```

2. Configure the json file in the config directory:
3. Install the required npm packages:
    ```sh
    yarn 

    yarn start
    ```

4. Build and Package (not finish)
   ```sh
   yarn pkg
   ```

## Directory Structure
```sh
.
├── config
│   ├── default.json
│   ├── development.json
│   └── production.json
├── index.ts
├── package.json
├── package-lock.json
├── README.md
├── tsconfig.json
├── utils
│   ├── bitcoin.ts
│   ├── exsat.ts
│   ├── logger.ts
│   └── util.ts
└── yarn.lock

```
