import { PrismaClient, Prisma } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter,
});

const userData: Prisma.UserCreateInput[] = [
    {
        email: "admin@saloonleo.lk",
        firstName: "Admin",
        lastName: "Leo",
        password: "$2a$12$E0aQQTA8fhVAPFsT.YA/2ugghOF99nTx362fR.oCCiqj8jhLzi/zq",
        privileges: []
    },
];

export async function main() {
  for (const u of userData) {
    await prisma.user.create({ data: u });
  }
}

main();