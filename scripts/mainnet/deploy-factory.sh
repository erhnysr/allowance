#!/usr/bin/env bash
# Allowance - deploy AllowanceFactory to Arc Mainnet.
# Usage: bash deploy-factory.sh [keystore-name]   (default keystore name: arc-mainnet)
# Needs AllowanceFactory.bin next to this script:
#   forge inspect contracts/AllowanceFactory.sol:AllowanceFactory bytecode > scripts/mainnet/AllowanceFactory.bin
# The private key never leaves your machine: cast reads it from your encrypted
# Foundry keystore and asks for its password.
set -euo pipefail
cd "$(dirname "$0")"

RPC="${RPC:-https://rpc.mainnet.arc.io}"
EXPLORER="${EXPLORER:-https://explorer.arc.io}"
EXPECTED_CHAIN="${EXPECTED_CHAIN:-5042}"
USDC="0x3600000000000000000000000000000000000000"
ACCOUNT="${1:-arc-mainnet}"
BIN="AllowanceFactory.bin"

say() { printf '\n%s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

command -v cast >/dev/null 2>&1 || die "Foundry (cast) not found. Install: curl -L https://foundry.paradigm.xyz | bash, then foundryup"
[ -s "$BIN" ] || die "$BIN not found next to this script."

CHAIN="$(cast chain-id --rpc-url "$RPC")"
[ "$CHAIN" = "$EXPECTED_CHAIN" ] || die "Chain $CHAIN, expected $EXPECTED_CHAIN. Stopping."
say "Network: Arc (chain $CHAIN)  RPC: $RPC"

say "Keystore '$ACCOUNT' password (to show the deployer address):"
FROM="$(cast wallet address --account "$ACCOUNT")"
BAL="$(cast balance "$FROM" --rpc-url "$RPC" --ether)"
say "Deployer:  $FROM"
echo "Balance:   $BAL USDC"

CODE="$(tr -d '\n' < "$BIN")"
GAS="$(env -u ETH_PASSWORD cast estimate --rpc-url "$RPC" --from "$FROM" --create "$CODE" "constructor(address)" "$USDC")"
PRICE="$(cast gas-price --rpc-url "$RPC")"
COST="$(cast to-unit "$(( GAS * PRICE ))" ether)"
echo "Gas estimate: $GAS"
echo "Fee estimate: ~$COST USDC"

say "About to deploy AllowanceFactory(usdc=$USDC) to Arc Mainnet."
read -r -p "Type 'yes' to continue: " OK
[ "$OK" = "yes" ] || die "Cancelled, nothing was sent."

say "Sending (keystore password again)..."
OUT="$(cast send --rpc-url "$RPC" --account "$ACCOUNT" --json --create "$CODE" "constructor(address)" "$USDC")"
ADDR="$(printf '%s' "$OUT" | grep -o '"contractAddress":"0x[0-9a-fA-F]\{40\}"' | grep -o '0x[0-9a-fA-F]\{40\}' || true)"
TX="$(printf '%s' "$OUT" | grep -o '"transactionHash":"0x[0-9a-fA-F]\{64\}"' | grep -o '0x[0-9a-fA-F]\{64\}' || true)"
STATUS="$(printf '%s' "$OUT" | grep -o '"status":"0x[01]"' | grep -o '0x[01]' || true)"
[ -n "$ADDR" ] && [ "$STATUS" = "0x1" ] || die "Deployment did not confirm. Do not re-run before checking the explorer. Output: $OUT"

GOT_USDC="$(env -u ETH_PASSWORD cast call "$ADDR" "usdc()(address)" --rpc-url "$RPC")"
[ "$(printf '%s' "$GOT_USDC" | tr 'A-F' 'a-f')" = "$USDC" ] || die "usdc() returned an unexpected address: $GOT_USDC"

{
  echo "network=arc-mainnet"
  echo "chain=$CHAIN"
  echo "factory=$ADDR"
  echo "tx=$TX"
  echo "deployer=$FROM"
} > deploy-result.txt

say "DEPLOYED"
echo "Factory: $ADDR"
echo "Tx:      $EXPLORER/tx/$TX"
