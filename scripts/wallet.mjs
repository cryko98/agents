// Generate a fresh Solana keypair for the crew wallet.
// Usage: node scripts/wallet.mjs
// Put the PUBLIC key in AGENT_WALLET_PUBLIC (safe to share) and, only when you go live,
// the SECRET in AGENT_WALLET_SECRET on Vercel. Never commit the secret.
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const kp = Keypair.generate();
console.log("AGENT_WALLET_PUBLIC=" + kp.publicKey.toBase58());
console.log("AGENT_WALLET_SECRET=" + bs58.encode(kp.secretKey));
console.log("\nFund the public address with a little SOL. Keep the secret in Vercel env vars only.");
