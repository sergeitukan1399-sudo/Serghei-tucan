-- Alisa Decor & Balloons — галерея работ, которую студия ведёт из панели /admin
-- Выполнить один раз после основной миграции CRM: Supabase → SQL Editor → вставить файл целиком → Run.
-- Повторный запуск безопасен: таблица и хранилище создаются только если их нет, стартовые работы — только в пустую таблицу.

begin;

-- ---------------------------------------------------------------------------
-- Работы. Читает и пишет только сервер сайта (сервисный ключ): публичный список
-- отдаёт /api/works, изменения — /api/admin/works после проверки администратора.
-- ---------------------------------------------------------------------------
create table if not exists public.works (
  id          uuid primary key default gen_random_uuid(),
  image_url   text not null,                 -- крупное фото: путь на сайте (img/01.webp) или ссылка на хранилище
  thumb_url   text not null,                 -- миниатюра для ленты
  image_path  text,                          -- файлы в хранилище «works»; null у стартовых работ из папки сайта
  thumb_path  text,
  title_ru    text not null check (char_length(title_ru) between 1 and 80),
  sub_ru      text not null default '' check (char_length(sub_ru) <= 80),
  desc_ru     text not null default '' check (char_length(desc_ru) <= 300),
  title_ro    text not null default '' check (char_length(title_ro) <= 80),
  sub_ro      text not null default '' check (char_length(sub_ro) <= 80),
  desc_ro     text not null default '' check (char_length(desc_ro) <= 300),
  tags        text[] not null default '{}',
  sort        integer not null default 0,
  visible     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists works_sort_idx on public.works (sort, created_at);

create or replace function public.works_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists works_touch_trg on public.works;
create trigger works_touch_trg
  before update on public.works
  for each row execute function public.works_touch();

-- Доступ из браузера закрыт: политик нет, работает только сервисный ключ сервера.
alter table public.works enable row level security;

-- ---------------------------------------------------------------------------
-- Хранилище фото: публичное чтение (фото показываются на сайте), загрузка — только сервером.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('works', 'works', true, 5242880, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Стартовые работы — те, что уже есть на сайте. Добавляются только в пустую таблицу.
-- ---------------------------------------------------------------------------
insert into public.works (image_url, thumb_url, title_ru, sub_ru, desc_ru, title_ro, sub_ro, desc_ro, tags, sort)
select * from (values
  ('img/01.webp', 'img/t/01.webp', 'День рождения 10 лет', 'Серебряные цифры и сердца', 'Фольгированная цифра «10» и сердца на грузиках — фотосессия в светлой студии.', 'Ziua de naștere, 10 ani', 'Cifre argintii și inimioare', 'Cifra „10” din folie și inimioare pe greutăți — ședință foto într-un studio luminos.', array['ДР','Подарок']::text[], 10),
  ('img/17.webp', 'img/t/17.webp', 'День рождения 30 лет', 'Розово-чёрная гирлянда', 'Гирлянда из хромированных шаров и белые панели с надписями.', 'Ziua de naștere, 30 de ani', 'Ghirlandă roz cu negru', 'Ghirlandă din baloane cromate și panouri albe cu inscripții.', array['ДР','Фотозона']::text[], 20),
  ('img/35.webp', 'img/t/35.webp', 'Сюрприз любимой', 'Море шаров-сердец', 'Десятки красных шаров-сердец под потолком спальни и надпись Love из фольги.', 'Surpriză pentru iubită', 'O mare de baloane-inimioare', 'Zeci de baloane roșii în formă de inimă sub tavanul dormitorului și inscripția Love din folie.', array['Любовь','Подарок']::text[], 30),
  ('img/33.webp', 'img/t/33.webp', 'Новогодняя ёлка', 'Красные банты и огни', 'Живая ёлка с огромным бархатным бантом, красными бантами, цветами и шарами.', 'Brad de Anul Nou', 'Funde roșii și luminițe', 'Brad natural cu o fundă uriașă din catifea, funde roșii, flori și globuri.', array['Новый год']::text[], 40),
  ('img/32.webp', 'img/t/32.webp', 'Ёлочный шар с фото', 'Персональная игрушка', 'Прозрачный шар с фотографией внутри, белыми бусинами и серебряным бантом.', 'Glob de brad cu fotografie', 'Jucărie personalizată', 'Glob transparent cu fotografie înăuntru, mărgele albe și fundă argintie.', array['Новый год','Подарок']::text[], 50),
  ('img/34.webp', 'img/t/34.webp', 'Новогодний магазин', 'Золотые зеркальные шары', 'Десятки золотых шаров под потолком торгового зала обувного магазина.', 'Magazin de Anul Nou', 'Baloane aurii cu efect de oglindă', 'Zeci de baloane aurii sub tavanul unui magazin de încălțăminte.', array['Новый год','Бизнес']::text[], 60),
  ('img/31.webp', 'img/t/31.webp', 'Мишка в шаре', 'Подарок с конфетти-сердцами', 'Большой плюшевый мишка в прозрачном шаре с красными сердцами, на подарочной тубе с бантом.', 'Ursuleț în balon', 'Cadou cu confetti-inimioare', 'Un ursuleț mare de pluș într-un balon transparent cu inimioare roșii, pe un tub-cadou cu fundă.', array['Подарок']::text[], 70),
  ('img/30.webp', 'img/t/30.webp', 'Подарок в шаре', 'Сюрприз для мужчины', 'Бутылка в прозрачном шаре на подарочной коробке, зелёные атласные ленты и бант.', 'Cadou în balon', 'Surpriză pentru un bărbat', 'O sticlă într-un balon transparent pe o cutie-cadou, cu panglici verzi din satin și fundă.', array['Подарок']::text[], 80),
  ('img/29.webp', 'img/t/29.webp', 'Коробка-сюрприз', 'Шары-сердца и надпись', 'Большая чёрная коробка с персональной надписью и связка красно-чёрных сердец.', 'Cutie-surpriză', 'Baloane-inimioare și inscripție', 'O cutie neagră mare cu inscripție personalizată și un buchet de inimioare roșii și negre.', array['Подарок','Любовь']::text[], 90),
  ('img/05.webp', 'img/t/05.webp', 'Первый годик Эльдара', 'Голубая арка с подсветкой', 'Арка из голубых и белых шаров с неоновой лентой и светящейся цифрой «1».', 'Primul anișor al lui Eldar', 'Arcadă albastră cu iluminare', 'Arcadă din baloane albastre și albe, cu bandă neon și cifra „1” luminoasă.', array['ДР','Фотозона','Дети']::text[], 100),
  ('img/25.webp', 'img/t/25.webp', 'День рождения Серафима', 'Море голубых шаров', 'Фотозона с именем, зеркальные шары и сотни шаров на полу зала.', 'Ziua de naștere a lui Serafim', 'O mare de baloane albastre', 'Fotozonă cu nume, baloane cu efect de oglindă și sute de baloane pe podeaua sălii.', array['ДР','Фотозона']::text[], 110),
  ('img/18.webp', 'img/t/18.webp', 'День рождения', 'Изумруд и золото', 'Гирлянды из зелёных и золотых шаров вокруг панели Happy Birthday.', 'Zi de naștere', 'Smarald și auriu', 'Ghirlande din baloane verzi și aurii în jurul panoului Happy Birthday.', array['ДР','Фотозона']::text[], 120),
  ('img/28.webp', 'img/t/28.webp', 'Детский день рождения', 'Розовый круг с зайчиком', 'Круглая панель, розовые и золотые шары и фигура зайчика.', 'Zi de naștere pentru copii', 'Cerc roz cu iepuraș', 'Panou rotund, baloane roz și aurii și o figurină de iepuraș.', array['ДР','Фотозона','Дети']::text[], 130),
  ('img/22.webp', 'img/t/22.webp', 'Первый годик', 'Арка с мишкой', 'Бежевые и золотые шары, белая арка и большой плюшевый мишка.', 'Primul anișor', 'Arcadă cu ursuleț', 'Baloane bej și aurii, arcadă albă și un ursuleț mare de pluș.', array['ДР','Фотозона','Дети']::text[], 140),
  ('img/03.webp', 'img/t/03.webp', 'День рождения на улице', 'Тропическая фотозона', 'Стена из зелени, тропические листья и шары в розово-зелёной гамме.', 'Zi de naștere în aer liber', 'Fotozonă tropicală', 'Perete din verdeață, frunze tropicale și baloane în nuanțe de roz și verde.', array['ДР','Фотозона']::text[], 150),
  ('img/20.webp', 'img/t/20.webp', 'День рождения во дворе', 'Белое облако шаров', 'Белые и розовые шары, неон Happy Birthday и сладкий стол на улице.', 'Zi de naștere în curte', 'Nor alb de baloane', 'Baloane albe și roz, neon Happy Birthday și masă cu dulciuri în aer liber.', array['ДР','Фотозона']::text[], 160),
  ('img/06.webp', 'img/t/06.webp', 'Подарок на 10 лет', 'Шар-сердце с надписью', 'Персональная надпись «Happy Birthday Mark» и золотая цифра.', 'Cadou pentru 10 ani', 'Balon-inimă cu inscripție', 'Inscripție personalizată „Happy Birthday Mark” și cifră aurie.', array['ДР','Подарок']::text[], 170),
  ('img/16.webp', 'img/t/16.webp', 'Юбилей 50 лет', 'Чёрно-золотая фотозона', 'Рамка из чёрных и золотых шаров вокруг баннера «С Юбилеем!».', 'Jubileu de 50 de ani', 'Fotozonă negru cu auriu', 'Ramă din baloane negre și aurii în jurul unui banner aniversar.', array['Юбилей','Фотозона','ДР']::text[], 180),
  ('img/19.webp', 'img/t/19.webp', 'Юбилей 70 лет', 'Пайетки и белые цветы', 'Золотая стена из пайеток, неон Happy Birthday и цветочные гирлянды.', 'Jubileu de 70 de ani', 'Paiete și flori albe', 'Perete auriu din paiete, neon Happy Birthday și ghirlande de flori.', array['Юбилей','Фотозона','ДР']::text[], 190),
  ('img/23.webp', 'img/t/23.webp', 'Юбилей 70 лет', 'Серебро и белый', 'Серебряные цифры «70», хромированные шары и пальмовые листья.', 'Jubileu de 70 de ani', 'Argintiu și alb', 'Cifre argintii „70”, baloane cromate și frunze de palmier.', array['Юбилей','ДР']::text[], 200),
  ('img/11.webp', 'img/t/11.webp', 'Свадьба I&V', 'Белые цветы и неон', 'Белая панель с инициалами, цветочные колонны и свечи на подиуме.', 'Nunta I&V', 'Flori albe și neon', 'Panou alb cu inițiale, coloane din flori și lumânări pe podium.', array['Свадьба','Фотозона']::text[], 210),
  ('img/09.webp', 'img/t/09.webp', 'Свадебная церемония', 'Цветочная арка', 'Голубые и розовые цветы, хрустальные люстры и свечи на подиуме.', 'Ceremonie de nuntă', 'Arcadă din flori', 'Flori albastre și roz, candelabre de cristal și lumânări pe podium.', array['Свадьба']::text[], 220),
  ('img/12.webp', 'img/t/12.webp', 'Свадьба', 'Колонны из цветов', 'Голубые и белые цветочные колонны в белых рамах.', 'Nuntă', 'Coloane din flori', 'Coloane din flori albastre și albe, în rame albe.', array['Свадьба']::text[], 230),
  ('img/24.webp', 'img/t/24.webp', 'Свадьба', 'Пайетки и белые цветы', 'Серебряная стена из пайеток в облаке белых цветов с подсветкой.', 'Nuntă', 'Paiete și flori albe', 'Perete argintiu din paiete într-un nor de flori albe, cu iluminare.', array['Свадьба','Фотозона']::text[], 240),
  ('img/02.webp', 'img/t/02.webp', 'Девичник', 'Буквы BRIDE', 'Серебряные буквы из фольги для фотосессии подружек невесты.', 'Petrecerea burlăcițelor', 'Literele BRIDE', 'Litere argintii din folie pentru ședința foto a domnișoarelor de onoare.', array['Свадьба','Девичник']::text[], 250),
  ('img/15.webp', 'img/t/15.webp', 'Крещение Nichita Mihai', 'Голубая арка с именами', 'Голубые, бежевые и персиковые шары вокруг белой арки с именами.', 'Botezul lui Nichita Mihai', 'Arcadă albastră cu nume', 'Baloane albastre, bej și piersicii în jurul unei arcade albe cu nume.', array['Крещение','Фотозона','Дети']::text[], 260),
  ('img/13.webp', 'img/t/13.webp', 'Банкетный зал', 'Бежевые шары и мишки', 'Гирлянды из шаров на стене, фонтаны шаров и мишки на столах.', 'Sală de banchet', 'Baloane bej și ursuleți', 'Ghirlande de baloane pe perete, fântâni de baloane și ursuleți pe mese.', array['Зал','Дети']::text[], 270),
  ('img/07.webp', 'img/t/07.webp', 'Банкет', 'Голубые шары у стола', 'Голубые фольгированные и латексные шары у длинного банкетного стола.', 'Banchet', 'Baloane albastre lângă masă', 'Baloane albastre din folie și latex lângă o masă lungă de banchet.', array['Зал']::text[], 280),
  ('img/14.webp', 'img/t/14.webp', 'Оформление кафе', 'Цветущая сакура', 'Розовые ветви сакуры над столиками и тёплые подвесные лампы.', 'Decor pentru cafenea', 'Sakura înflorită', 'Crengi roz de sakura deasupra meselor și lămpi suspendate cu lumină caldă.', array['Зал','Бизнес']::text[], 290),
  ('img/26.webp', 'img/t/26.webp', 'Оформление кафе', 'Зелень и подсветка', 'Свисающая зелень с фиолетовой подсветкой и трава в перегородках.', 'Decor pentru cafenea', 'Verdeață și iluminare', 'Verdeață suspendată cu iluminare violet și iarbă în paravane.', array['Зал','Бизнес']::text[], 300),
  ('img/04.webp', 'img/t/04.webp', 'Новогодний фасад', 'Вход магазина BIANKO', 'Еловые колонны с золотыми шарами и большими бантами у входа.', 'Fațadă de Anul Nou', 'Intrarea magazinului BIANKO', 'Coloane din crengi de brad cu globuri aurii și funde mari la intrare.', array['Фасад','Бизнес','Новый год']::text[], 310),
  ('img/27.webp', 'img/t/27.webp', 'Фотозона с крыльями', 'Бежевое золото', 'Белые крылья из перьев между гирляндами с неоновой лентой.', 'Fotozonă cu aripi', 'Bej și auriu', 'Aripi albe din pene între ghirlande, cu bandă neon.', array['Фотозона']::text[], 320),
  ('img/10.webp', 'img/t/10.webp', 'Фотозона', 'Синие арки и лимоны', 'Драпированные арки, синие гортензии и жёлтые акценты на подиуме.', 'Fotozonă', 'Arcade albastre și lămâi', 'Arcade drapate, hortensii albastre și accente galbene pe podium.', array['Фотозона']::text[], 330),
  ('img/08.webp', 'img/t/08.webp', 'Фотозона', 'Драпировка и свечи', 'Светлая драпировка, цветочные композиции и свечи в колбах.', 'Fotozonă', 'Draperie și lumânări', 'Draperie deschisă la culoare, aranjamente florale și lumânări în borcane.', array['Фотозона','Свадьба']::text[], 340)
) as v(image_url, thumb_url, title_ru, sub_ru, desc_ru, title_ro, sub_ro, desc_ro, tags, sort)
where not exists (select 1 from public.works);

commit;
