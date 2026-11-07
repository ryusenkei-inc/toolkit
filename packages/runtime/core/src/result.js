export function ok(value) {
    return { ok: true, value };
}
export const err = (error) => ({ ok: false, error });
