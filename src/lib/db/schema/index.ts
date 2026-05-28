import {
  mysqlTable,
  int,
  varchar,
  text,
  datetime,
  index,
} from 'drizzle-orm/mysql-core';

export const arecs = mysqlTable(
  'arecs',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id'),
    uid: varchar('uid', { length: 64 }),
    contactEmail: varchar('contact_email', { length: 256 }).notNull(),
    accountName: varchar('account_name', { length: 64 }).notNull(),
    ownerKey: text('owner_key'),
    oldOwnerKey: text('old_owner_key'),
    newOwnerKey: text('new_owner_key'),
    memoKey: text('memo_key'),
    provider: varchar('provider', { length: 64 }),
    emailConfirmationCode: varchar('email_confirmation_code', { length: 64 }),
    validationCode: varchar('validation_code', { length: 64 }),
    requestSubmittedAt: datetime('request_submitted_at'),
    remoteIp: varchar('remote_ip', { length: 45 }),
    status: varchar('status', { length: 32 }).default('open'),
    createdAt: datetime('created_at').notNull().default(new Date()),
    updatedAt: datetime('updated_at')
      .notNull()
      .default(new Date())
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    idxAccountName: index('idx_arecs_account_name').on(table.accountName),
    idxContactEmail: index('idx_arecs_contact_email').on(table.contactEmail),
    idxUid: index('idx_arecs_uid').on(table.uid),
  })
);
