#!/usr/bin/env bash
# Allowance - one agent payment on Arc Mainnet.
# The agent key signs an EIP-712 PaymentIntent; the relayer key submits payWithSig.
# Usage: bash agent-pay.sh <ACCOUNT> <PAYEE> <AMOUNT_USDC> [MEMO]
#   AGENT_KS   keystore name of the agent   (default: agent-mainnet)
#   RELAYER_KS keystore name of the relayer (default: arc-mainnet)
# Keys stay in your encrypted Foundry keystores; cast asks for their passwords.
set -euo pipefail
cd "$(dirname "$0")"

RPC="${RPC:-https://rpc.mainnet.arc.io}"
EXPLORER="${EXPLORER:-https://explorer.arc.io}"
EXPECTED_CHAIN="${EXPECTED_CHAIN:-5042}"
FACTORY="${FACTORY:-0xa48fdee3cc6ec2909da8fbec0d2f14032e92c5ec}"
AGENT_KS="${AGENT_KS:-agent-mainnet}"
RELAYER_KS="${RELAYER_KS:-arc-mainnet}"

say() { printf '\n%s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
c() { env -u ETH_PASSWORD cast "$@"; }   # read-only calls never touch keystores

[ $# -ge 3 ] || die "Usage: bash agent-pay.sh <ACCOUNT> <PAYEE> <AMOUNT_USDC> [MEMO]"
ACCOUNT="$1"; PAYEE="$2"; AMOUNT="$3"; MEMO="${4:-}"
command -v cast >/dev/null 2>&1 || die "Foundry (cast) not found."
[[ "$ACCOUNT" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "Invalid account address: $ACCOUNT"
[[ "$PAYEE" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "Invalid payee address: $PAYEE"
[ "${#MEMO}" -le 31 ] || die "Memo can be at most 31 characters."

CHAIN="$(c chain-id --rpc-url "$RPC")"
[ "$CHAIN" = "$EXPECTED_CHAIN" ] || die "Chain $CHAIN, expected $EXPECTED_CHAIN. Stopping."
[ "$(c call "$FACTORY" "isAccount(address)(bool)" "$ACCOUNT" --rpc-url "$RPC")" = "true" ] \
  || die "$ACCOUNT is not an Allowance account of factory $FACTORY."

say "Agent keystore '$AGENT_KS' password:"
AGENT="$(cast wallet address --account "$AGENT_KS")"
AMT="$(c parse-units "$AMOUNT" 6)"
[ "$AMT" -gt 0 ] || die "Amount must be greater than zero."

reason_text() {
  case "$1" in
    0) echo "OK";; 1) echo "Amount is zero";; 2) echo "Account is frozen";; 3) echo "Agent not registered";;
    4) echo "Agent is revoked";; 5) echo "Agent has expired";; 6) echo "Invalid payee";;
    7) echo "Payee not allowed or blocked";; 8) echo "Over per-payment cap";;
    9) echo "Over period budget";; 10) echo "Over lifetime cap";; 11) echo "Over payee cap";;
    12) echo "Insufficient account balance";; *) echo "Unknown code $1";;
  esac
}

CODE="$(c call "$ACCOUNT" "check(address,address,uint128)(uint8)" "$AGENT" "$PAYEE" "$AMT" --rpc-url "$RPC")"
say "Account: $ACCOUNT"
echo "Agent:   $AGENT"
echo "Payee:   $PAYEE"
echo "Amount:  $AMOUNT USDC ($AMT units)"
echo "Memo:    ${MEMO:-(empty)}"
echo "check(): $CODE - $(reason_text "$CODE")"

FORCE=0
if [ "$CODE" != "0" ]; then
  say "The policy rejects this payment. Type 'force' to submit it anyway and record the onchain rejection."
  read -r -p "Press Enter to cancel: " F
  [ "$F" = "force" ] || die "Cancelled, nothing was sent."
  FORCE=1
fi

# EIP-712 domain read from the contract, then checked against what we expect.
DOMAIN="$(c call "$ACCOUNT" "eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])" --rpc-url "$RPC")"
D_NAME="$(printf '%s\n' "$DOMAIN" | sed -n 2p | tr -d '"')"
D_VER="$(printf '%s\n' "$DOMAIN" | sed -n 3p | tr -d '"')"
D_CHAIN="$(printf '%s\n' "$DOMAIN" | sed -n 4p | awk '{print $1}')"
D_VC="$(printf '%s\n' "$DOMAIN" | sed -n 5p)"
[ "$D_NAME" = "Allowance" ] && [ "$D_VER" = "1" ] && [ "$D_CHAIN" = "$CHAIN" ] \
  && [ "$(printf '%s' "$D_VC" | tr 'A-F' 'a-f')" = "$(printf '%s' "$ACCOUNT" | tr 'A-F' 'a-f')" ] \
  || die "Unexpected EIP-712 domain: $DOMAIN"

NONCE="$(c to-dec "0x$(openssl rand -hex 32)")"
[ "$(c call "$ACCOUNT" "nonceUsed(address,uint256)(bool)" "$AGENT" "$NONCE" --rpc-url "$RPC")" = "false" ] || die "Nonce collision, try again."
NOW="$(c block latest --field timestamp --rpc-url "$RPC")"
DEADLINE=$(( NOW + 600 ))
REF="$(c format-bytes32-string "$MEMO")"

TYPED="$(mktemp)"
trap 'rm -f "$TYPED"' EXIT
cat > "$TYPED" <<JSON
{
  "types": {
    "EIP712Domain": [
      {"name": "name", "type": "string"},
      {"name": "version", "type": "string"},
      {"name": "chainId", "type": "uint256"},
      {"name": "verifyingContract", "type": "address"}
    ],
    "PaymentIntent": [
      {"name": "agent", "type": "address"},
      {"name": "payee", "type": "address"},
      {"name": "amount", "type": "uint256"},
      {"name": "nonce", "type": "uint256"},
      {"name": "deadline", "type": "uint256"},
      {"name": "ref", "type": "bytes32"}
    ]
  },
  "primaryType": "PaymentIntent",
  "domain": {"name": "Allowance", "version": "1", "chainId": $CHAIN, "verifyingContract": "$ACCOUNT"},
  "message": {"agent": "$AGENT", "payee": "$PAYEE", "amount": "$AMT", "nonce": "$NONCE", "deadline": "$DEADLINE", "ref": "$REF"}
}
JSON

say "Agent signs the intent (agent keystore password again):"
SIG="$(cast wallet sign --data --from-file "$TYPED" --account "$AGENT_KS")"
INTENT="($AGENT,$PAYEE,$AMT,$NONCE,$DEADLINE,$REF)"
SIGSPEC="payWithSig((address,address,uint256,uint256,uint256,bytes32),bytes)"

if [ "$FORCE" = "0" ]; then
  c call "$ACCOUNT" "$SIGSPEC" "$INTENT" "$SIG" --rpc-url "$RPC" >/dev/null \
    || die "Simulation failed, nothing was sent."
  echo "Signature accepted by the contract in simulation."
fi

say "About to submit: $AMOUNT USDC -> $PAYEE"
read -r -p "Type 'yes' to continue: " OK
[ "$OK" = "yes" ] || die "Cancelled, nothing was sent."

say "Submitting (relayer keystore '$RELAYER_KS' password)..."
SEND_ARGS=(--rpc-url "$RPC" --account "$RELAYER_KS" --json)
[ "$FORCE" = "1" ] && SEND_ARGS+=(--gas-limit 300000)
OUT="$(cast send "${SEND_ARGS[@]}" "$ACCOUNT" "$SIGSPEC" "$INTENT" "$SIG" 2>&1 || true)"
TX="$(printf '%s' "$OUT" | grep -o '"transactionHash":"0x[0-9a-fA-F]\{64\}"' | grep -o '0x[0-9a-fA-F]\{64\}' | head -1 || true)"
STATUS="$(printf '%s' "$OUT" | grep -o '"status":"0x[01]"' | grep -o '0x[01]' | head -1 || true)"
[ -n "$TX" ] || die "Transaction was not sent. Output: $OUT"

{
  echo "time=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "account=$ACCOUNT"; echo "agent=$AGENT"; echo "payee=$PAYEE"
  echo "amount=$AMOUNT"; echo "memo=$MEMO"; echo "check=$CODE"
  echo "tx=$TX"; echo "status=$STATUS"
  echo "---"
} >> pay-result.txt

if [ "$STATUS" = "0x1" ]; then
  say "PAYMENT CONFIRMED"
else
  say "REJECTED ONCHAIN (expected: $(reason_text "$CODE"))"
fi
echo "Tx: $EXPLORER/tx/$TX"
