/**
 * DEVELOPMENT SEED — never run against production data.
 *   pnpm db:seed:dev          # seeds an empty database
 *   pnpm db:reset:dev         # wipes all data first, then seeds
 *
 * Development credentials created here (for local testing only):
 *   admin@queuesense.dev            DevAdmin#2026
 *   staff.admin@queuesense.dev      DevStaff#2026   (Administration counters)
 *   staff.print@queuesense.dev      DevStaff#2026   (Printing counters)
 *   staff.cafe@queuesense.dev       DevStaff#2026   (Cafeteria counters)
 *   staff.lift@queuesense.dev       DevStaff#2026   (Lift boarding)
 *   student01..student12@queuesense.dev   DevStudent#2026
 */
import { count } from "drizzle-orm";
import {
  cameraStations,
  counters,
  queueGroups,
  services,
  staffCounterAssignments,
  staffProfiles,
  studentProfiles,
  users,
} from "../drizzle/schema";
import { issueAuthCode } from "../server/accounts";
import { hashPassword } from "../server/auth/password";
import type { SessionUser } from "../server/auth/sessions";
import { closeDatabase, db, withTransaction } from "../server/db/client";
import { truncateAll } from "../server/db/reset";
import { actOnEntries, callNext, joinQueue } from "../server/queue/engine";

if (process.env.NODE_ENV === "production") {
  console.error(
    "Refusing to run the development seed with NODE_ENV=production."
  );
  process.exit(1);
}

type GroupSeed = {
  slug: string;
  name: string;
  description: string;
  unitLabel?: string;
  averageServiceSeconds: number;
  serveCapacity?: number;
  cameraAssist?: boolean;
  counters: Array<{ name: string; prefix: string }>;
};

const CATALOG: Array<{
  slug: string;
  name: string;
  kind: "ADMINISTRATION" | "PRINTING" | "CAFETERIA" | "ELEVATOR";
  description: string;
  notice?: string;
  groups: GroupSeed[];
}> = [
  {
    slug: "administration",
    name: "Administration",
    kind: "ADMINISTRATION",
    description:
      "Fees, certificates and admissions at the administrative block.",
    groups: [
      {
        slug: "accounts",
        name: "Accounts & Fees",
        description: "Fee payments, receipts and scholarship queries.",
        averageServiceSeconds: 240,
        cameraAssist: true,
        counters: [
          { name: "Accounts Desk 1", prefix: "F" },
          { name: "Accounts Desk 2", prefix: "G" },
        ],
      },
      {
        slug: "certificates",
        name: "Certificates",
        description: "Bonafide, transcripts and conduct certificates.",
        averageServiceSeconds: 300,
        counters: [{ name: "Certificates Desk", prefix: "C" }],
      },
      {
        slug: "admissions",
        name: "Admissions",
        description: "Enrolment, ID cards and student records.",
        averageServiceSeconds: 360,
        counters: [{ name: "Admissions Desk", prefix: "A" }],
      },
    ],
  },
  {
    slug: "printing",
    name: "Printing",
    kind: "PRINTING",
    description: "Xerox, colour and bulk report printing at the print centre.",
    groups: [
      {
        slug: "xerox",
        name: "Xerox",
        description: "Black & white photocopies.",
        unitLabel: "jobs",
        averageServiceSeconds: 90,
        counters: [{ name: "Xerox Counter", prefix: "X" }],
      },
      {
        slug: "colour",
        name: "Colour Printing",
        description: "Colour prints and posters.",
        unitLabel: "jobs",
        averageServiceSeconds: 180,
        counters: [{ name: "Colour Desk", prefix: "P" }],
      },
      {
        slug: "reports",
        name: "Report / Bulk Printing",
        description: "Project reports, spiral binding and bulk jobs.",
        unitLabel: "jobs",
        averageServiceSeconds: 420,
        counters: [
          { name: "Report Counter A", prefix: "RA" },
          { name: "Report Counter B", prefix: "RB" },
        ],
      },
    ],
  },
  {
    slug: "cafeteria",
    name: "Cafeteria",
    kind: "CAFETERIA",
    description:
      "Hold your place in the cafeteria line instead of standing in it.",
    notice:
      "QueueSense manages your place in line only. Ordering and payment happen at the counter.",
    groups: [
      {
        slug: "dine-in",
        name: "Dine-in",
        description: "Order at the counter and eat in.",
        averageServiceSeconds: 75,
        cameraAssist: true,
        counters: [{ name: "Dine-in Counter", prefix: "D" }],
      },
      {
        slug: "takeaway",
        name: "Takeaway",
        description: "Order to take away.",
        averageServiceSeconds: 60,
        counters: [{ name: "Takeaway Counter", prefix: "T" }],
      },
    ],
  },
  {
    slug: "elevator",
    name: "Elevator / Lift",
    kind: "ELEVATOR",
    description:
      "Virtual boarding queue and traffic estimate for the main block lifts.",
    notice:
      "QueueSense estimates lift traffic and manages a virtual boarding queue. It does not control the lifts.",
    groups: [
      {
        slug: "lift-1",
        name: "Lift 1",
        description: "Main block, east lift.",
        unitLabel: "riders",
        averageServiceSeconds: 90,
        serveCapacity: 8,
        cameraAssist: true,
        counters: [{ name: "Lift 1 boarding", prefix: "LA" }],
      },
      {
        slug: "lift-2",
        name: "Lift 2",
        description: "Main block, west lift.",
        unitLabel: "riders",
        averageServiceSeconds: 90,
        serveCapacity: 8,
        cameraAssist: true,
        counters: [{ name: "Lift 2 boarding", prefix: "LB" }],
      },
    ],
  },
];

const DEPARTMENTS = [
  "Computer Science",
  "Electronics",
  "Mechanical",
  "Civil",
  "Business Administration",
  "Biotechnology",
];
const FIRST = [
  "Aarav",
  "Diya",
  "Kabir",
  "Meera",
  "Rohan",
  "Sara",
  "Vihaan",
  "Ananya",
  "Ishaan",
  "Nisha",
  "Arjun",
  "Tara",
];

async function main() {
  const reset = process.argv.includes("--reset");
  if (reset) {
    await truncateAll();
    console.log("Cleared existing data.");
  } else {
    const [{ n }] = await db.select({ n: count() }).from(users);
    if (n > 0) {
      console.error(
        "Database already has users. Use `pnpm db:reset:dev` to wipe and reseed."
      );
      process.exitCode = 1;
      return;
    }
  }

  const adminHash = await hashPassword("DevAdmin#2026");
  const staffHash = await hashPassword("DevStaff#2026");
  const studentHash = await hashPassword("DevStudent#2026");
  const now = new Date();

  const ids = await withTransaction(async tx => {
    const [admin] = await tx
      .insert(users)
      .values({
        email: "admin@queuesense.dev",
        name: "Campus Admin",
        role: "ADMIN",
        status: "ACTIVE",
        passwordHash: adminHash,
        passwordUpdatedAt: now,
      })
      .$returningId();
    await tx
      .insert(staffProfiles)
      .values({
        userId: admin.id,
        employeeId: "ADM-001",
        designation: "Operations Administrator",
      });

    const staffSeed = [
      {
        key: "ADMINISTRATION",
        email: "staff.admin@queuesense.dev",
        name: "Priya Raman",
        employeeId: "STF-101",
        designation: "Accounts Officer",
      },
      {
        key: "PRINTING",
        email: "staff.print@queuesense.dev",
        name: "Imran Sheikh",
        employeeId: "STF-102",
        designation: "Print Centre Lead",
      },
      {
        key: "CAFETERIA",
        email: "staff.cafe@queuesense.dev",
        name: "Lakshmi Iyer",
        employeeId: "STF-103",
        designation: "Cafeteria Supervisor",
      },
      {
        key: "ELEVATOR",
        email: "staff.lift@queuesense.dev",
        name: "Joseph Mathew",
        employeeId: "STF-104",
        designation: "Facilities Attendant",
      },
    ];
    const staffIds = new Map<string, number>();
    for (const staff of staffSeed) {
      const [row] = await tx
        .insert(users)
        .values({
          email: staff.email,
          name: staff.name,
          role: "STAFF",
          status: "ACTIVE",
          passwordHash: staffHash,
          passwordUpdatedAt: now,
        })
        .$returningId();
      await tx
        .insert(staffProfiles)
        .values({
          userId: row.id,
          employeeId: staff.employeeId,
          designation: staff.designation,
        });
      staffIds.set(staff.key, row.id);
    }

    const counterIds: Record<string, number> = {};
    const groupIds: Record<string, number> = {};
    for (const [serviceIndex, service] of CATALOG.entries()) {
      const [svc] = await tx
        .insert(services)
        .values({
          slug: service.slug,
          name: service.name,
          kind: service.kind,
          description: service.description,
          notice: service.notice ?? null,
          displayOrder: serviceIndex,
        })
        .$returningId();
      for (const [groupIndex, group] of service.groups.entries()) {
        const [grp] = await tx
          .insert(queueGroups)
          .values({
            serviceId: svc.id,
            slug: group.slug,
            name: group.name,
            description: group.description,
            unitLabel: group.unitLabel ?? "people",
            averageServiceSeconds: group.averageServiceSeconds,
            serveCapacity: group.serveCapacity ?? 1,
            cameraAssist: group.cameraAssist ?? false,
            cameraModerateAt: service.kind === "ELEVATOR" ? 10 : 6,
            cameraHeavyAt: service.kind === "ELEVATOR" ? 20 : 12,
            displayOrder: groupIndex,
          })
          .$returningId();
        groupIds[group.slug] = grp.id;
        for (const [counterIndex, counter] of group.counters.entries()) {
          const [ctr] = await tx
            .insert(counters)
            .values({
              queueGroupId: grp.id,
              name: counter.name,
              tokenPrefix: counter.prefix,
              displayOrder: counterIndex,
              statusUpdatedAt: now,
            })
            .$returningId();
          counterIds[counter.prefix] = ctr.id;
          await tx
            .insert(staffCounterAssignments)
            .values({
              staffUserId: staffIds.get(service.kind)!,
              counterId: ctr.id,
              assignedByUserId: admin.id,
            });
        }
      }
    }

    await tx.insert(cameraStations).values([
      {
        name: "Lift lobby camera",
        queueGroupId: groupIds["lift-1"],
        roi: { x: 0.12, y: 0.2, width: 0.76, height: 0.64 },
      },
      {
        name: "Cafeteria entrance camera",
        queueGroupId: groupIds["dine-in"],
        roi: { x: 0.1, y: 0.25, width: 0.8, height: 0.6 },
      },
      {
        name: "Accounts hall camera",
        queueGroupId: groupIds["accounts"],
        roi: { x: 0.15, y: 0.2, width: 0.7, height: 0.65 },
      },
    ]);

    const students: SessionUser[] = [];
    for (let i = 1; i <= 12; i++) {
      const number = String(i).padStart(2, "0");
      const email = `student${number}@queuesense.dev`;
      const name = `${FIRST[i - 1]} ${["Sharma", "Nair", "Reddy", "Khan", "Das", "Pillai"][i % 6]}`;
      const [row] = await tx
        .insert(users)
        .values({
          email,
          name,
          role: "STUDENT",
          status: "ACTIVE",
          passwordHash: studentHash,
          passwordUpdatedAt: now,
        })
        .$returningId();
      await tx
        .insert(studentProfiles)
        .values({
          userId: row.id,
          collegeId: `QS24CS${String(100 + i)}`,
          department: DEPARTMENTS[i % DEPARTMENTS.length],
          phone: `+91 98450 ${String(10000 + i * 137).slice(0, 5)}`,
        });
      students.push({
        id: row.id,
        email,
        name,
        role: "STUDENT",
        status: "ACTIVE",
      });
    }

    const pendingCodes: string[] = [];
    for (let i = 13; i <= 14; i++) {
      const email = `student${i}@queuesense.dev`;
      const [row] = await tx
        .insert(users)
        .values({
          email,
          name: `Pending Student ${i}`,
          role: "STUDENT",
          status: "PENDING",
        })
        .$returningId();
      await tx
        .insert(studentProfiles)
        .values({
          userId: row.id,
          collegeId: `QS24CS${100 + i}`,
          department: "Computer Science",
        });
      const { code } = await issueAuthCode(tx, row.id, "ACTIVATION", admin.id);
      pendingCodes.push(`${email}  ${code}`);
    }
    return {
      admin: {
        id: admin.id,
        email: "admin@queuesense.dev",
        name: "Campus Admin",
        role: "ADMIN" as const,
        status: "ACTIVE" as const,
      },
      students,
      counterIds,
      groupIds,
      pendingCodes,
    };
  });

  // Realistic starting activity, created through the real queue engine.
  const { admin, students, groupIds, counterIds } = ids;
  const join = (student: number, group: string, counter?: string) =>
    joinQueue(students[student], {
      queueGroupId: groupIds[group],
      counterId: counter ? counterIds[counter] : undefined,
    });
  await join(0, "accounts", "F");
  await join(1, "accounts", "F");
  const served = await callNext(admin, counterIds.F);
  await actOnEntries(admin, {
    entryIds: served.called.map(c => c.id),
    action: "SERVE",
  });
  await actOnEntries(admin, {
    entryIds: served.called.map(c => c.id),
    action: "COMPLETE",
  });
  await join(2, "accounts", "F");
  await join(3, "accounts", "G");
  await join(4, "reports", "RA");
  await join(5, "reports", "RB");
  await join(6, "reports", "RA");
  await join(7, "reports", "RB");
  await join(8, "dine-in");
  await join(9, "dine-in");
  await join(10, "takeaway");
  await join(11, "lift-1");

  console.log(
    "\nDevelopment data ready. See scripts/seed-dev.ts for local credentials."
  );
  console.log("Pending accounts (activate at /activate):");
  ids.pendingCodes.forEach(line => console.log(`  ${line}`));
  console.log("");
}

try {
  await main();
} catch (error) {
  console.error("Seed failed:", error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
