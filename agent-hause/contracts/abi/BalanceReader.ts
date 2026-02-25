export const BalanceReader = [
  {
    inputs: [{ internalType: 'address[]', name: 'accounts', type: 'address[]' }],
    name: 'getNativeBalances',
    outputs: [{ internalType: 'uint256[]', name: '', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;
