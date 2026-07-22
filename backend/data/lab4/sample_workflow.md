# Tested Workflow: Online Vehicle Registration Renewal

Source: UAT sign-off, Digital Services team. Status: PASSED (all steps verified).
Audience for the job aid: front-counter staff assisting walk-in citizens.

## Workflow steps (as tested)

1. Open the Renewals portal at dmv.state.gov/renew and select **Vehicle Registration Renewal**.
2. Ask the citizen for their license plate number and the last 4 digits of the VIN; enter both into the lookup form and click **Find Vehicle**.
3. Confirm the vehicle details on screen (make, model, year, owner name) match the citizen's documents. If they do not match, stop and refer the citizen to the Title Corrections desk.
4. Check for outstanding compliance holds (emissions, insurance lapse, unpaid citations). If a hold is shown, the renewal cannot proceed — print the Hold Notice and hand it to the citizen.
5. Verify current proof of insurance: the policy expiry date must be on or after today. If expired, ask the citizen for an updated insurance card before continuing.
6. Select the renewal term: 1 year or 2 years. Read the displayed fee total aloud to the citizen and confirm they accept it.
7. Collect payment. For card payments, insert/tap on the counter terminal; for cash, enter the amount tendered and give change from the drawer.
8. Wait for the **Payment Approved** confirmation, then click **Issue Registration**.
9. Print the new registration card and the two adhesive renewal stickers on the sticker printer.
10. Hand the registration card and stickers to the citizen, and tell them the month/year sticker goes on the rear plate, top-right corner.
11. Click **Finish & Log** to close the transaction. Confirm the receipt has emailed or printed for the citizen.

## Known edge cases surfaced during testing
- If the sticker printer jams, reprint from **Transactions > Reprint Stickers** using the transaction ID; do not restart the whole renewal.
- Personalized/vanity plates route to a manual review queue after step 8 and may take 1–2 minutes to return the Issue button.
