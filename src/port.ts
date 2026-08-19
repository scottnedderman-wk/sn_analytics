export function listenPort(env: { PORT?: string } = process.env): number {
  return Number(env.PORT ?? 3000);
}
