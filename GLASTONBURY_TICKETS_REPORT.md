# Automating the Glastonbury Ticket Purchase: Research & Recommendations

*Prepared 15 August 2026. Next on-sale target: Glastonbury 2027 (coach packages and general admission expected ~November 2026).*

---

## TL;DR

1. **Glastonbury is the one big festival where a purchase bot is close to useless — and risky.** Since 2024 the sale runs on a **random queue** (See Tickets/queue technology): everyone already on the page at kick-off is given a *random* place. Speed, refreshing, multiple tabs and multiple devices do **not** move you up — they can get your IP flagged as a bot and *removed*.
2. **You cannot resell a Glastonbury ticket, so the whole economic reason bots exist doesn't apply.** Tickets are non-transferable, carry the registered holder's **photo**, and are checked against ID on the gate. A spare goes back to the official face-value resale pool, not to a buyer you found.
3. **A bot that automates the real checkout is against See Tickets' terms and probably a criminal offence** under the Digital Economy Act 2017 / Breaching Limits on Ticket Sales Regulations 2018 (unlimited fine in England & Wales), and could engage the Computer Misuse Act 1990.
4. **"People use AI to guarantee tickets" is mostly myth or marketing.** Guaranteed-ticket services are largely scams; the genuine bot scene targets *resale-heavy* platforms (Ticketmaster-style), and even there the big anti-bot vendors (Queue-it, Akamai, Cloudflare) now mitigate ~98% of bot traffic.
5. **What actually raises your odds is legitimate and boring:** everyone registered correctly, a group of up to six, one fast wired device per person, payment details memorised/ready, on the page *before* the snapshot, and *don't refresh*. This is exactly what the Festival itself advises.
6. **The right thing to "build and simulation-test" is your own execution** — not the live site. This report ships with a **local rehearsal simulator** (`glasto-rehearsal.html`) that mimics the queue → form → payment flow so your group can drill for speed and accuracy without ever touching See Tickets.

---

## 1. How the Glastonbury sale actually works

Understanding the mechanism is the whole game, because it's unlike a normal Ticketmaster drop.

### Registration (the real gate)
- You must **register in advance** at `glastonburyregistration.co.uk` with contact details and a **passport-style photo**. Registration is free and separate from buying.
- **Every person** who intends to hold a ticket (age 13+) needs **their own registration number** *before* the sale.
- Registrations don't expire the way tickets do, but the Festival periodically asks older registrations (pre-2020) to update their photo — check yours is valid well ahead of time.

### The sale
- Tickets are sold **only** at `glastonbury.seetickets.com`. Anywhere else is a scam.
- Sales come in waves: **coach + ticket packages first** (a Thursday), then **general admission** (the following Sunday). For 2027 expect this around **November 2026**; exact dates are announced in autumn.
- One person can buy up to **six** tickets in a single transaction, entering the **registration number + surname** of each person in the group plus lead-booker details and a deposit payment.
- A **deposit** (~£75/ticket in recent years) is taken at sale; the **balance** is due in spring.

### The random queue (the decisive change, since 2024)
- If you're on the sale page **when it opens**, you're placed **randomly** in the queue.
- If you arrive/click **after** kick-off, you go to the **back**.
- **Refreshing can lose your place** and look like bot behaviour. Using **multiple tabs/browsers/devices** can trigger anti-bot software and get your **IP blocked**.
- Net effect: the sale is now a **lottery among everyone present at the snapshot**, not a race. This is precisely what defeats refresh-bots.

### Anti-touting (why reselling is a dead end)
- Tickets are **non-transferable** and show the **holder's photo**; security checks admit only that person.
- Reselling privately is prohibited and gets the order **cancelled**.
- Genuine spares are resold **at face value through See Tickets** in official resale windows (typically spring). Resales sell out in ~30 minutes too.

### How fast does it sell out?
Fast, but not milliseconds — this matters for what "automation" could even buy you:

| Sale | Sold out in |
|---|---|
| 2025 coach + packages (Nov 2024) | ~32 minutes |
| 2025 general admission (Nov 2024) | ~35 minutes |
| 2025 coach resale (Apr 2025) | ~31 minutes |
| 2024 coach resale | ~18 minutes |

Thirty-plus minutes means the constraint is **whether the random queue lets you in**, and then **how fast and accurately you complete the form** — not raw request speed.

---

## 2. "Using AI to guarantee tickets" — what's real and what isn't

**Short version: nobody can *guarantee* a Glastonbury ticket, and anyone selling that is selling a scam.**

Breaking down the claim:

- **Guaranteed-ticket / "AI bot" services for sale online** — treat as fraud. There is no product that guarantees a photo-locked, registration-gated, random-queue ticket. At best they take your money; at worst they take your registration/payment credentials.
- **The genuine ticket-bot scene** exists, but it targets **high-resale-value, first-come** inventory (the Ticketmaster world) where the payoff is scalping. Glastonbury has **no resale value**, so the incentive that funds serious bot development isn't there.
- **The anti-bot industry has caught up.** Ticketing platforms use **Queue-it, Akamai Bot Manager, Cloudflare** and similar. Public figures from these vendors: ~**98% of traffic** mitigated on a hype event, **>50% of blocked bots share one IP**, and genuine fans reported ~**50× better odds** once bot mitigation + virtual waiting rooms were in place. So even on scalp-friendly sites, off-the-shelf bots increasingly lose.
- **What "AI" realistically does in this space** is narrow: solving or bypassing CAPTCHAs, rotating fingerprints/IPs, and OCR/vision to read a page state. Against Glastonbury's **random queue + photo lock**, none of that produces a ticket — it just raises your ban risk.

### Real-world attempts (instructive, now largely obsolete)
Open-source projects like **`glasto-helper`** (Jack O'Hara, Puppeteer) and its forks did work in the **old refresh-based era** (2023–2024): they opened ~15 headless browsers, reloaded the holding page at just under the site's rate limit (~59/min), and used **text-similarity** detection to jump to whichever tab had reached the ticket page. That was a clever *refresh optimiser*.

**Why it no longer helps:** the 2024 move to a *random* queue removes the thing those tools optimised. There's no advantage to refreshing into — your position is fixed at the snapshot, and aggressive reloading now reads as bot behaviour. The technique that used to work is the technique the new system is designed to punish.

---

## 3. The legal and terms-of-service position (read this before writing any code)

This is not legal advice, but the landscape is clear enough to plan around:

- **Digital Economy Act 2017, s.106 + The Breaching Limits on Ticket Sales Regulations 2018.** It is a **criminal offence** to use software to do anything that enables buying tickets **in excess of the limit** a seller sets, for recreational/cultural/sporting events. Penalty: **unlimited fine** (England & Wales); up to £50,000 (Scotland). Glastonbury sets a 6-per-transaction limit and one-registration-per-person; software aimed at beating those controls is squarely in scope.
- **See Tickets' terms of use** (like every major ticketer's) prohibit automated access, bots, scraping of the purchase flow, and circumventing access controls. Breach → **order cancelled, account/IP blocked**.
- **Computer Misuse Act 1990.** Deliberately circumventing a site's technical access controls (queue, rate limits, bot checks) can raise unauthorised-access questions.
- **Practical enforcement you'll actually hit first:** the anti-bot layer flags you, your **IP is blocked**, and you're out of *this* sale — the worst possible outcome for a fan.

**Where the line sits, concretely:**

| Activity | Verdict |
|---|---|
| Pre-registering everyone; preparing payment; being ready to type fast | ✅ Encouraged by the Festival |
| Practising the checkout flow on a **local mock** you control | ✅ Fine (this report ships one) |
| A shared checklist / countdown / "who's covering which registration numbers" plan | ✅ Fine |
| A script that auto-refreshes or holds a queue slot on the **live** site | ❌ Against ToS, counter-productive, ban risk |
| A script that auto-fills / auto-submits the **real** purchase or payment | ❌ Likely DEA 2017 offence + ToS breach + CMA risk |
| Multiple devices/IPs/fingerprints to get more queue entries | ❌ Anti-bot trigger, IP ban, and against the rules |

This is why the recommendation below is to **build for rehearsal, not for the live sale**.

---

## 4. Recommendations for development — "simulated testing" done the right way

You correctly identified the core problem: **there's no test period, so you can't prove a concept against the real sale.** The professional answer to "I can't test against production" is **build a faithful simulation and test against that.** For Glastonbury the thing worth optimising is *your group's human execution*, so that's what the simulation should exercise.

### 4.1 What to build (and what ships with this report)

**A. Offline rehearsal simulator — `glasto-rehearsal.html`** *(included in this repo)*
A single, self-contained HTML file that reproduces the *shape* of the sale so you can drill it:
- **Random queue screen** with a realistic randomised wait, so you practise *waiting without refreshing*.
- **Booking form** requiring 6× (registration number + surname) + lead-booker details, with the same validation traps as the real one (wrong-format registration numbers, mismatched names).
- **Payment screen** with a deposit field and a **deliberate lockout** if you fumble card details — mirroring See Tickets' "wrong card details can freeze you for up to 10 minutes" behaviour, so your group learns to enter payment *right the first time*.
- **A stopwatch and error counter** so each run gives you a **time-to-complete** and **accuracy** score to improve on.
- **Zero network calls.** It never contacts See Tickets or anything else. It's a flight simulator, not an autopilot.

**B. A group readiness pack** (low-tech, high-impact):
- A shared sheet with every member's **registration number + exact surname** (pre-verified, correct format), assigned so each buyer knows which six they'd enter.
- Payment details **prepared and correct** (UK debit / Visa / Mastercard; know the international-card rules; have Apple/Google Pay set up if you'll use it).
- A **connection plan**: wired ethernet or strong 5G, on the page a few minutes early, phone on silent, no other heavy downloads.

**C. Optional, still-legitimate tooling:**
- A **countdown + checklist app** that opens the *official* URL at the right minute and reminds each person of their steps (a to-do list, not an actor on the page).
- A **synced-clock display** so everyone starts from the same accurate time.

### 4.2 How to run the simulated testing

1. **Individual drills:** each person runs `glasto-rehearsal.html` repeatedly until they can complete a booking in well under a minute with zero validation errors.
2. **Group scenario:** simulate the real plan — everyone tries; whoever gets through "first" in the sim reads out registration numbers while another checks. Rehearse the hand-off out loud.
3. **Failure injection:** deliberately fumble a card number to feel the lockout; practise recovering calmly. Practise a mistyped registration number and correcting it fast.
4. **Score and iterate:** track time-to-complete and error count across runs. This is your KPI — not "requests per second."

### 4.3 Explicitly out of scope (and why)
- No headless automation of `glastonbury.seetickets.com`.
- No auto-refresh / queue-holding / slot-warming against the live site.
- No auto-fill or auto-submit of the real purchase or payment.
- No multi-device / multi-IP / fingerprint tricks.

Each of the above is against the rules, likely unlawful, and — uniquely for Glastonbury — **lowers** your chances by getting you flagged, while buying you nothing you could ever resell.

---

## 5. The realistic play for Glastonbury 2027

1. **Now → autumn 2026:** make sure everyone in your group of up to six is **registered with a current photo** and has their number recorded. This is the single biggest determinant of success — un-registered people simply can't buy.
2. **When dates are announced (autumn 2026):** put both the **coach/package** (first) and **general admission** (second) sale times in the calendar. Coach packages are a genuine second bite at the cherry.
3. **Rehearse** with the simulator until the form-filling is muscle memory.
4. **On the day:** every registered member on **one fast device each**, on the page a few minutes before kick-off, **payment ready**, and then **do not refresh** — let the random queue run. A full group of six multiplies your collective odds several-fold.
5. **If you miss out:** the **official See Tickets resale** (spring) at face value is your legitimate second chance — same drill applies.

The uncomfortable but honest bottom line: Glastonbury deliberately engineered the sale so that **preparation and luck** decide it, not code. The best "automation" you can build is a group that executes flawlessly — and that you *can* test.

---

## Sources

- [Info — Glastonbury Festivals](https://www.glastonburyfestivals.co.uk/info/) · [Tickets — Glastonbury Festival](https://www.glastonburyfestivals.co.uk/information/tickets/)
- [Glastonbury announces big change to ticket booking — BBC](https://feeds.bbci.co.uk/news/articles/c62l9yw3kpqo) · [Will Glastonbury's new queue system finally end the chaos? — Euronews](https://www.euronews.com/culture/2024/11/06/will-glastonburys-new-queue-system-finally-end-the-ticket-buying-chaos) · [Time Out: booking process change](https://www.timeout.com/uk/news/glastonbury-is-changing-its-booking-process-this-year-heres-everything-you-need-to-know-110624)
- [Top tips for getting Glastonbury tickets — Time Out](https://www.timeout.com/uk/news/glastonbury-ticket-sale-tips-103123) · [How to buy Glastonbury tickets: tips & tricks — GlastoFestFeed](https://www.glastofestfeed.com/features/lists-guides/how-to-buy-glastonbury-tickets-tips-tricks/) · [Improve your chances — Tech Advisor](https://www.techadvisor.com/article/2519478/how-to-improve-your-chances-of-getting-glastonbury-tickets.html)
- [Case study: Glastonbury's ticket registration system — Ticket Fairy](https://www.ticketfairy.com/blog/case-study-glastonbury-festivals-ticket-registration-system) · [Bogus ticket sellers warning — GlastoFestFeed](https://www.glastofestfeed.com/news/information/glastonbury-bogus-tickets-2024-resale/)
- [glasto-helper (Puppeteer refresh app) — GitHub](https://github.com/JackOHara/glasto-helper) · [Improving my odds with Puppeteer — Jack O'Hara](https://old.jackohara.com/glastonbury/) · [glasto-helper-2025 fork](https://github.com/jltwheeler/glasto-helper-2025)
- [2025 coach packages sell out in 32 minutes — NME](https://www.nme.com/news/music/glastonbury-2025-coach-and-ticket-packages-sell-out-in-32-minutes-3812850) · [2025 coach resale in 31 minutes — NME](https://www.nme.com/news/music/glastonbury-2025-coach-resale-tickets-sell-out-in-31-minutes-and-prompt-mixed-response-from-fans-3858033)
- [Ticket scalping bots now illegal in UK — PRS for Music](https://www.prsformusic.com/m-magazine/news/ticket-scalping-bots-now-illegal-in-uk) · [Bots and touts: offences summary — Crucible Law](https://crucible.law/insights/bots-and-touts-a-summary-of-offences-potentially-committed-by-bot-owners-and-ticket-resellers) · [Digital Economy Act 2017 — Wikipedia](https://en.wikipedia.org/wiki/Digital_Economy_Act_2017)
- [Everything you need to know about ticket bots — Queue-it](https://queue-it.com/blog/ticket-bots/) · [Hype Event Protection (Queue-it + Akamai)](https://queue-it.com/hype-event-protection/) · [Protecting hype events — Akamai](https://www.akamai.com/blog/security/protect-hype-events-bot-proof-launches-akamai-queue-it)
- [When do Glastonbury 2027 tickets go on sale? — TicketSquad](https://ticket-squad.io/guides/glastonbury-tickets)
