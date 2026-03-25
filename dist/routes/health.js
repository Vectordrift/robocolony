export async function healthRoutes(app) {
    app.get('/health', async (_request, _reply) => {
        return { status: 'ok' };
    });
}
//# sourceMappingURL=health.js.map