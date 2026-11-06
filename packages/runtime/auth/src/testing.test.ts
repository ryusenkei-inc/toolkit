import { authenticatorContract } from './contract.ts';
import { memoryAuthenticator } from './testing.ts';

const identity = { subject: 'u1', email: 'u1@example.com', groups: ['admin'] };

authenticatorContract('memoryAuthenticator', () => memoryAuthenticator({ 'token-1': identity }), {
  valid: () => new Request('https://app.example.com/', { headers: { authorization: 'token-1' } }),
  identity,
  invalid: [() => new Request('https://app.example.com/'), () => new Request('https://app.example.com/', { headers: { authorization: 'other' } })],
});
