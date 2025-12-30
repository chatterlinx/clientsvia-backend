### Gold Set Replay Harness (Scaffold)

This folder is the starting point for **world-class regression testing** of the AI receptionist.

#### Goal
- Prevent KPI regressions before publish/deploy:
  - **Booking completion %**
  - **Containment %**
  - **Median + p90 call seconds**

#### Structure
- `gold_set.json`: canonical test cases (happy path + messy callers)
- `run.js`: runner skeleton (loads cases, simulates turns, validates outcomes)

#### Notes
- This is intentionally a scaffold. Next step is to plug into the existing runtime entry point
  (the same path Twilio uses) and persist run results with deltas.


