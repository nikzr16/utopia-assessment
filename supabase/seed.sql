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

-- Staff with sign-in emails (<firstname>@sejuk.example.com). The sign-in accounts
-- themselves are created by `npm run auth:create-staff-logins`; the link trigger
-- (or link_staff_accounts) connects each account to its staff row by email.
insert into staff (name, email, phone, role, branch_id)
select s.name, s.email, s.phone, s.role::staff_role, b.id
from (values
  -- Admins
  ('Aisyah Rahman',   'aisyah@sejuk.example.com',  '60120000001', 'admin',      'Kuala Lumpur'),
  ('Farid Hakim',     'farid@sejuk.example.com',   '60120000002', 'admin',      'Shah Alam'),
  -- Technicians (the brief's four technicians)
  ('Ali',             'ali@sejuk.example.com',     '60120000011', 'technician', 'Shah Alam'),
  ('John',            'john@sejuk.example.com',    '60120000012', 'technician', 'Kuala Lumpur'),
  ('Bala',            'bala@sejuk.example.com',    '60120000013', 'technician', 'Shah Alam'),
  ('Yusoff',          'yusoff@sejuk.example.com',  '60120000014', 'technician', 'Shah Alam'),
  -- Managers
  ('Nurul Huda',      'nurul@sejuk.example.com',   '60120000021', 'manager',    'Shah Alam'),
  ('Tan Wei Ming',    'weiming@sejuk.example.com', '60120000022', 'manager',    'Kuala Lumpur'),
  ('Lim Mei Ling',    'meiling@sejuk.example.com', '60120000023', 'manager',    'Penang'),
  ('Hafiz Osman',     'hafiz@sejuk.example.com',   '60120000024', 'manager',    'Johor Bahru'),
  ('Grace Lojuni',    'grace@sejuk.example.com',   '60120000025', 'manager',    'Kota Kinabalu'),
  -- Finance
  ('Siti Aminah',     'siti@sejuk.example.com',    '60120000031', 'finance',    'Kuala Lumpur')
) as s(name, email, phone, role, branch_name)
join branches b on b.name = s.branch_name
on conflict do nothing;

-- If sign-in accounts already exist (seeding an existing project), link them.
select link_staff_accounts();
