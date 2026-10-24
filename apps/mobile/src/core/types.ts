export interface User {
  id: string;
  name: string;
  email: string;
}
export interface Auth {
  token: string;
  expiresAt: string;
  user: User;
}
export interface Client {
  id: string;
  name: string;
  contact: string;
  phone: string;
  createdAt: string;
}
export interface Package {
  id: string;
  clientId: string;
  title: string;
  totalLessons: number;
  priceKopecks: number;
  paymentStatus: 'pending' | 'paid';
  paidLessons: number;
  completedLessons: number;
  remainingLessons: number;
  paidAt: string | null;
  createdAt: string;
}
export type PublicPackage = Omit<Package, 'clientId'>;
export interface Lesson {
  id: string;
  packageId: string;
  scheduledAt: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  updatedAt: string;
}
export interface Detail {
  package: Package;
  lessons: Lesson[];
}
export interface PublicDetail {
  package: PublicPackage;
  lessons: Lesson[];
}
export interface ClientDetail {
  client: Client;
  packages: Package[];
}
export interface Dashboard {
  asOf: string;
  totals: {
    clientCount: number;
    paidPackageCount: number;
    pendingPackageCount: number;
    confirmedPaymentsKopecks: number;
    pendingPaymentsKopecks: number;
    completedLessons: number;
    remainingLessons: number;
    remainingValueKopecks: number;
  };
  renewals: {
    clientId: string;
    clientName: string;
    packageId: string;
    packageTitle: string;
    totalLessons: number;
    priceKopecks: number;
    remainingLessons: number;
  }[];
  upcomingLessons: {
    id: string;
    packageId: string;
    clientId: string;
    clientName: string;
    packageTitle: string;
    scheduledAt: string;
  }[];
}
