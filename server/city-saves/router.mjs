// Mount with the existing backend's authenticated guest and CSRF middleware.
// The host must use a route-specific bounded JSON parser before the existing 32kb
// default parser; CORS remains the host's existing exact-origin policy.
export function citySaveRouter({ Router, service, guest, csrf }) {
  const router = Router();
  router.get('/', guest, async (req,res,next) => { try { res.json(await service.list(req.account.id)); } catch(e) { next(e); } });
  router.get('/:cityId', guest, async (req,res,next) => { try { res.json(await service.read(req.account.id,req.params.cityId)); } catch(e) { next(e); } });
  router.post('/', guest, csrf, async (req,res,next) => { try { res.json(await service.mutate(req.account.id,req.get('idempotency-key'),req.body)); } catch(e) { next(e); } });
  return router;
}
