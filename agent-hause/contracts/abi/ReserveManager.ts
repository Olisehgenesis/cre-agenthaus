export const ReserveManager = [
  {
    inputs: [
      {
        components: [
          { internalType: 'uint256', name: 'totalMinted', type: 'uint256' },
          { internalType: 'uint256', name: 'totalReserve', type: 'uint256' }
        ],
        internalType: 'struct ReserveManager.ReserveUpdate',
        name: 'data',
        type: 'tuple'
      }
    ],
    name: 'updateReserves',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const;
