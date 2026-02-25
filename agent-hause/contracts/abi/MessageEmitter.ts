export const MessageEmitter = [
  {
    inputs: [{ internalType: 'address', name: 'emitter', type: 'address' }],
    name: 'getLastMessage',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;
