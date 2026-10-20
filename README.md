# MyDropPocket

DropPocket – Lovable MVP Prompt

Build a modern SaaS web application called DropPocket.

Tagline:
Your receipts, warranties and purchase documents — safely stored in one place.

Product Vision

DropPocket is a cloud-based application where users can securely store purchase receipts, warranty documents and installment agreements.

The application should solve one simple problem:

Never lose an important receipt or purchase document again.

This is an MVP focused on simplicity, speed and premium user experience.

Do NOT build advanced inventory management or AI analytics yet.

Focus only on the core features below.

Technology

Use:

React

TypeScript

Tailwind CSS

Supabase Authentication

Supabase Database

Supabase Storage

The application must be responsive and optimized for both desktop and mobile.

Use a clean Apple / Notion inspired interface with lots of white space, rounded cards, soft shadows and smooth animations.

Authentication

Allow login using:

Email

Google

Apple

Each user must only have access to their own documents.

Dashboard

Display three main modules.

🛡 Warranties

Store warranty receipts and important purchases.

Show:

Active warranties

Expiring soon

Expired

Button:

Add Warranty

💰 Expenses

Store everyday expenses.

Button:

Add Expense

Show:

This month total

This week total

Recent expenses

📄 Agreements

Store:

Installment agreements

Warranty extensions

Purchase contracts

Service agreements

Button:

Add Agreement

Module 1 — Warranty Receipts

The user can:

Take a photo

Upload image

Upload PDF

After upload AI should automatically detect if possible:

Store name

Purchase date

Total amount

Product name

Fill detected values automatically.

Allow editing every field.

IMPORTANT:

Always preserve the original uploaded file.

Never overwrite or compress the original receipt.

Generate an optional scanned PDF copy while keeping the original intact.

Each warranty purchase contains:

Product name

Store

Purchase date

Warranty expiry

Amount

Notes

Original receipt

PDF version

Actions:

View original

Download original

Download PDF

Print

Delete

Show remaining warranty days.

Green = Active

Orange = Expiring soon

Red = Expired

Allow warranty reminder notifications.

Module 2 — Expenses

The user can create expenses:

With receipt

or

Without receipt

Examples:

Groceries

Fuel

Restaurant

Coffee

Hairdresser

Nails

Shopping

Healthcare

Travel

Pets

Custom category

Required fields:

Amount

Category

Date

Description

Optional:

Receipt photo

Receipt PDF

Notes

If a receipt is uploaded AI should automatically read available information.

Module 3 — Agreements

Store:

Installment agreements

Warranty extensions

Purchase contracts

Service agreements

The original document must always remain unchanged.

Allow:

Upload PDF

Upload image

Download

Print

Delete

AI should detect if possible:

Company

Agreement number

Start date

End date

Monthly payment

Total amount

Everything remains editable.

Global Search

One search field for the whole application.

Search by:

Store

Product

Agreement

Category

Date

Amount

Company

Results should include all three modules.

Cloud Storage

Store all uploaded files securely inside Supabase Storage.

Store metadata inside Supabase Database.

Original documents must never be modified.

Notifications

Notify users when:

Warranty expires within 30 days.

Settings

User Profile

Dark Mode

Light Mode

Language

Notification settings

Design

Modern SaaS

Premium feeling

Minimal

Elegant

Fast

Rounded cards

Beautiful icons

Excellent mobile experience

No clutter

Easy navigation

Future Ready

Structure the application so future versions can easily add:

Home Inventory

AI Assistant

Family Accounts

Business Accounts

Insurance Reports

Expense Analytics

Home Asset Tracking

Do not build these features now.

Only prepare the architecture so they can be added later without major redesign.

The goal of this MVP is to launch quickly, validate the idea with real users and create a premium product people are willing to pay a monthly subscription for. Ja palun kasuta seda logo pilti mis ma panin

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://mydroppocket.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/05f96460-0af4-4e48-856e-5d4948255403).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
