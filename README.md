# عربيتي — 3rbyty.com

Car-parts marketplace: buyers, sellers and shops across Egypt.

| Folder | What |
| --- | --- |
| `backend/` | API: Express 5, Mongoose, zod (Node). Also serves the built site and dashboard. |
| `front/` | Website: React 18, Vite, Tailwind. |
| `admin/` | Admin dashboard: React 19, Mantine. Served at `/admin`. |
| `deploy/` | `make-package.mjs` puts the three builds into the one Node app the host runs. |
| `test-cards/` | Sample business cards for the card reader. |

Build: `npm run build` in `backend`, `front` and `admin`, then `node deploy/make-package.mjs`.
