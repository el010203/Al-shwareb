import { handleSubscriptions } from '../../server/subscriptions.mjs';
export async function onRequest({ request, env }) {
  return handleSubscriptions(request, env);
}
