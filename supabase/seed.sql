-- 0000 System foundation: seed data (branches, service types, staff).
-- No sample orders. Phone numbers are fake.

insert into branches (name) values
  ('Kuala Lumpur'),
  ('Shah Alam'),
  ('Penang'),
  ('Johor Bahru'),
  ('Kota Kinabalu')
on conflict (name) do nothing;

insert into service_types (name) values
  ('Aircond cleaning'),
  ('Repair'),
  ('Gas refill'),
  ('Installation'),
  ('General servicing')
on conflict (name) do nothing;

-- Staff with sign-in emails <name>.<role>.<branch>@sejuk.example.com (0010; role
-- admin / manager / tech / finance, branch kl / sa / pg / jb / kk). The sign-in accounts
-- themselves are created by `npm run auth:create-staff-logins`; the link trigger
-- (or link_staff_accounts) connects each account to its staff row by email.
insert into staff (name, email, phone, role, branch_id)
select s.name, s.email, s.phone, s.role::staff_role, b.id
from (values
  -- Admins
  ('Aisyah Rahman',   'aisyah.admin.kl@sejuk.example.com',     '60120000001', 'admin',      'Kuala Lumpur'),
  ('Farid Hakim',     'farid.admin.sa@sejuk.example.com',      '60120000002', 'admin',      'Shah Alam'),
  -- Technicians (the brief's four technicians)
  ('Ali',             'ali.tech.sa@sejuk.example.com',         '60120000011', 'technician', 'Shah Alam'),
  ('John',            'john.tech.kl@sejuk.example.com',        '60120000012', 'technician', 'Kuala Lumpur'),
  ('Bala',            'bala.tech.sa@sejuk.example.com',        '60120000013', 'technician', 'Shah Alam'),
  ('Yusoff',          'yusoff.tech.sa@sejuk.example.com',      '60120000014', 'technician', 'Shah Alam'),
  -- Managers
  ('Nurul Huda',      'nurul.manager.sa@sejuk.example.com',    '60120000021', 'manager',    'Shah Alam'),
  ('Tan Wei Ming',    'weiming.manager.kl@sejuk.example.com',  '60120000022', 'manager',    'Kuala Lumpur'),
  ('Lim Mei Ling',    'meiling.manager.pg@sejuk.example.com',  '60120000023', 'manager',    'Penang'),
  ('Hafiz Osman',     'hafiz.manager.jb@sejuk.example.com',    '60120000024', 'manager',    'Johor Bahru'),
  ('Grace Lojuni',    'grace.manager.kk@sejuk.example.com',    '60120000025', 'manager',    'Kota Kinabalu'),
  -- Finance
  ('Siti Aminah',     'siti.finance.kl@sejuk.example.com',     '60120000031', 'finance',    'Kuala Lumpur')
) as s(name, email, phone, role, branch_name)
join branches b on b.name = s.branch_name
on conflict do nothing;

-- If sign-in accounts already exist (seeding an existing project), link them.
select link_staff_accounts();
