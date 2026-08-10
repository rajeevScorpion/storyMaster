/**
 * Page size for every catalogue listing, client and server.
 *
 * It lives here rather than beside the browser components because the route
 * shells need it too, and importing a plain constant from a `'use client'`
 * module does not give the server that constant — it gives a client-reference
 * stub. Arithmetic on the stub produced `NaN`, `.range(0, NaN)` made PostgREST
 * return zero rows while still reporting the true count, and the gallery
 * rendered "26 stories" above an empty-state panel for months.
 *
 * Any value both sides share belongs in a module neither side owns.
 */
export const GALLERY_PAGE_SIZE = 12;
