# Free deployment: Oracle Cloud Always Free + DuckDNS

Everything (Postgres, API, CRM, HTTPS, nightly backups) runs on **one always-on free ARM server**. Nothing sleeps, and images and backups stay on the server's disk.

```
iPhones ─┐                       ┌─ /api/*, /uploads/*  → API (NestJS)  ─┐
         ├─ https://kiteshop.duckdns.org ─ Caddy ─┤                       ├─ PostgreSQL (same server)
Browser ─┘   (free Let's Encrypt cert)  └─ everything else  → CRM (Next.js) ─┘
```

**Cost: ₹0.** Oracle asks for a card only to verify your identity. Always Free resources aren't charged. Don't upgrade the account to Pay-As-You-Go unless you mean to.

Free-tier limits as of Nov 2026: Ampere A1 = **2 OCPUs + 12 GB RAM** total, 200 GB block storage ([Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)). That is plenty for 12 sellers; the load test ran 313 bills/s on a laptop.

---

## Step 1 — Create the Oracle Cloud account (≈10 min)
1. Go to <https://www.oracle.com/cloud/free/> → **Start for free**.
2. Choose a **Home Region** close to the shop, e.g. **India West (Mumbai)** or **India South (Hyderabad)**. ⚠️ You can't change it later, and Always Free servers only run in the home region.
3. Finish the card verification.

## Step 2 — Create the server (≈5 min)
Console → **Compute → Instances → Create instance**:

| Setting | Value |
|---|---|
| Name | `kite-shop` |
| Image | **Canonical Ubuntu 24.04** (*Change image* → Ubuntu → 24.04, *aarch64*) |
| Shape | *Change shape* → **Ampere** → `VM.Standard.A1.Flex`, **2 OCPUs, 12 GB** |
| Networking | default VCN, public subnet, **Assign a public IPv4 address: Yes** |
| SSH keys | **Paste public key**: the contents of `~/.ssh/id_ed25519.pub` on this Mac (`cat ~/.ssh/id_ed25519.pub \| pbcopy`) |
| Boot volume | default (50 GB is fine; up to 200 GB is free) |

Click **Create**. When it's *Running*, note the **Public IP address**.

> "Out of capacity for shape VM.Standard.A1.Flex" is common in busy regions. Try another *Availability Domain* in the same form, or try again later; capacity frees up during the day.

## Step 3 — Open web ports in Oracle's cloud firewall (≈2 min)
Instance page → **Subnet** link → **Security Lists** → *Default Security List* → **Add Ingress Rules** (twice):

| Source CIDR | IP Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(Port 22 for SSH is already open. The install script opens 80/443 in the server's own firewall too.)

## Step 4 — Free domain with DuckDNS (≈2 min)
1. <https://www.duckdns.org> → sign in (Google/GitHub).
2. Add a subdomain, e.g. `kiteshop` → **kiteshop.duckdns.org**.
3. Put the server's **public IP** in *current ip* → **update ip**.

The IP stays the same while the instance exists, so this is a one-time step.

## Step 5 — Deploy from this Mac (≈15 min, mostly the first build)
Check you can log in: `ssh ubuntu@<PUBLIC_IP>` (answer *yes* to the fingerprint question, then `exit`).

```bash
cd ~/Documents/Kite-festival
ADMIN_USERNAME=owner ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='Choose#Temp2027' \
  ./deploy/push.sh ubuntu@<PUBLIC_IP> kiteshop.duckdns.org
```

What it does:
- uploads the last git commit (never `.env`, `node_modules` or local data);
- installs Docker and opens the server firewall;
- generates a production `.env` with random secrets **on the server**;
- builds and starts Postgres, API (runs migrations), CRM, Caddy (HTTPS) and the nightly backup job;
- creates your **owner** account (Super Admin).

The **dev accounts (admin01, seller01, …) are NOT created in production**.

Then open **https://kiteshop.duckdns.org**, sign in as `owner` with the temporary password, set your own password, and:
1. **Shop settings**: name, address, phone, invoice prefix.
2. **Users & roles**: create an account for each salesperson and admin.
3. **Products**: add them (or **Import CSV**), with opening stock.

## Step 6 — Point the iPhone app at the server
- **Testing with Expo Go:** run the dev server against production:
  `EXPO_PUBLIC_API_URL=https://kiteshop.duckdns.org/api/v1 pnpm dev:mobile`, then scan the QR code.
- **Real installs (TestFlight / ad-hoc):** set `EXPO_PUBLIC_API_URL` to `https://kiteshop.duckdns.org/api/v1` in `apps/mobile/eas.json` (`preview` and `production` profiles), then `eas build` (see deployment.md §4).

## Updating later
Commit your changes, then run the same command without the `ADMIN_*` variables:
```bash
./deploy/push.sh ubuntu@<PUBLIC_IP> kiteshop.duckdns.org
```
The script takes a database backup (`~/kite-shop/backups/pre-deploy-*.dump`) before rebuilding.

## Operations cheat-sheet (on the server: `ssh ubuntu@<PUBLIC_IP>`, then `cd ~/kite-shop`)
| Task | Command |
|---|---|
| Status | `sudo docker compose --profile app --profile prod ps` |
| Logs | `sudo docker compose logs -f api` (or `crm`, `caddy`) |
| Manual backup | `sudo docker compose exec -T db pg_dump -U kite -Fc kite > backups/manual-$(date +%F).dump` |
| Copy backups to your Mac | `scp 'ubuntu@<PUBLIC_IP>:kite-shop/backups/*.dump' ~/kite-backups/` |
| Restart everything | `sudo docker compose --profile app --profile prod restart` |

**Do copy backups off the server regularly** (e.g. weekly with the `scp` line above). A backup that only lives on the same server is lost along with the server.

## Free-tier caveats to know
- **Idle reclamation:** Oracle may stop Always Free instances that look idle, judged by low CPU, network *and* memory use over 7 days ([Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)). A POS server is quiet most of the time even when the shop is busy, so this can happen. Oracle emails you first. Defences:
  1. Keep off-server backups (below), so a stopped server is an inconvenience, not data loss.
  2. Upgrading the account to **Pay As You Go** keeps Always Free resources free. Oracle's docs say idle reclamation applies to Always Free *accounts*, so this avoids it, but a card stays on file and anything beyond the free limits would be charged. Check the current wording before deciding.
  3. Before the season, start the instance from the console if it was stopped. Data on the boot volume is kept.
- DuckDNS is a free community service. For a long-term shop domain, buy a `.in` domain (₹500–800/yr) and set `SITE_DOMAIN` to it.
