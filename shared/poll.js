// The exact text a holder signs with Phantom to cast a vote. Built the same way in the browser and the API.
export const voteMessage = (pollId, option, address, ts) =>
  `Cookers holder vote\npoll: ${pollId}\noption: ${option}\nwallet: ${address}\ntime: ${ts}`;
