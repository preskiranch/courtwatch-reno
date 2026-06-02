# Social Outreach Workflow

Court Watch AAU can prepare outreach for teams from recent completed tournaments without running an automated DM bot.

This workflow:

- Pulls live team, record, points, and final-placement data from the Court Watch API.
- Creates an outreach CSV and JSON queue.
- Generates two branded image cards per team.
- Builds a friendly message draft for each team.
- Provides Instagram and web search links to help you find the public team account.

It does not send messages automatically. Review each row and send messages manually so outreach stays personal and avoids platform spam enforcement.

## Generate Outreach Candidates

```bash
npm run outreach:generate
```

Useful options:

```bash
npm run outreach:generate -- --days=30
npm run outreach:generate -- --event=255539
npm run outreach:generate -- --max-teams=0
npm run outreach:generate -- --screenshots=false
```

Outputs are written to `outreach/generated/`:

- `outreach-candidates.csv`
- `outreach-candidates.json`
- `cards/*-achievement.png`
- `cards/*-parents.png`

## Manual Sending Flow

1. Open `outreach/generated/outreach-candidates.csv`.
2. Use the search links to confirm the correct Instagram/TikTok account.
3. Review the message draft.
4. Attach the two generated cards.
5. Send manually from the official Court Watch AAU account.

## Suggested Message

```text
Hello [Team Name],

Congratulations on [achievement] at [Tournament Name]. We built Court Watch AAU to make tournament weekends easier for parents and coaches, especially when families are tracking multiple teams at once.

Your team is already listed with schedules, records, brackets, points, and final placements. If you are open to it, please give the free site a try and send any feedback you are willing to share.

https://courtwatchaau.com
```

## Guardrails

- Do not bulk-send duplicate messages.
- Do not message the same account repeatedly.
- Confirm a handle belongs to the actual team before messaging.
- Keep the tone generous and low-pressure.
- Remove anyone from future outreach if they ask.
