// The exact text a holder signs with their wallet to chat with the crew. Built the same way in the browser and the API.
export const holderLoginMessage = (address, ts) =>
  `Cookers holder login\nwallet: ${address}\ntime: ${ts}\nThis only proves you own this wallet. It sends no transaction and costs nothing.`;
