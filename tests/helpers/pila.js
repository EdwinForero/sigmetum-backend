// Recorre la pila de Express 4 de forma recursiva: las capas con .route dan método, ruta y manejadores; las capas
// con name 'router' se recorren entrando en layer.handle.stack; una capa que no es ruta y cuyo manejador es
// tokenAuth es un use(tokenAuth) a nivel de router.
const { tokenAuth } = require('../../functions/tokenAuthentication');

const declaredRoutes = (app) => {
    if (!app._router || !Array.isArray(app._router.stack)) {
        throw new Error('No se encuentra app._router.stack: ¿cambió la versión de Express? Estos tests necesitan Express 4.');
    }
    const routes = [];
    const routerLevelAuth = [];
    const walkStack = (stack, trail) => {
        for (const layer of stack) {
            if (layer.route) {
                const handlers = layer.route.stack.map((l) => l.handle);
                for (const method of Object.keys(layer.route.methods).filter((m) => layer.route.methods[m])) {
                    routes.push({ method: method.toUpperCase(), path: String(layer.route.path), handlers, trail });
                }
            } else if (layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
                walkStack(layer.handle.stack, [...trail, 'router']);
            } else if (layer.handle === tokenAuth) {
                routerLevelAuth.push(trail.join('>') || 'app');
            }
        }
    };
    walkStack(app._router.stack, []);
    return { routes, routerLevelAuth };
};

module.exports = { declaredRoutes };
