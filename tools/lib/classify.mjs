// Self-contained asset classification: maps a Minecraft block/item name to a
// category/subcategory folder. Pure heuristics — no network, no
// external data, so builds are reproducible offline.

export const baseName = (name) => name.replace(/\.(png|webp|gif|jpe?g)$/i, "").toLowerCase();

export const titleCase = (name) =>
  name
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join("_");

const first = (name, rules, fallback) => {
  for (const [test, sub] of rules) if (test(name)) return sub;
  return fallback;
};

const ends = (suffix) => (n) => n.endsWith(suffix);
const has = (probe) => (n) => n.includes(probe);

const BLOCK_RULES = [
  [ends("_planks"), "02. Planks"],
  [(n) => /_(log|stem)$/.test(n), "07. Logs"],
  [(n) => /_(wood|hyphae)$/.test(n), "01. Wood"],
  [ends("_leaves"), "06. Leaves"],
  [ends("_ore"), "03. Ore"],
  [ends("_stained_glass_pane"), "05. Glass Pane"],
  [ends("_glass_pane"), "05. Glass Pane"],
  [ends("_glass"), "04. Glass"],
  [ends("_wool"), "32. Wool"],
  [has("concrete"), "15. Concrete"],
  [ends("_terracotta"), "28. Terracotta"],
  [ends("_carpet"), "14. Carpet"],
  [ends("_slab"), "25. Slabs"],
  [ends("_stairs"), "26. Stairs"],
  [ends("_door"), "19. Doors"],
  [ends("_trapdoor"), "29. Trapdoors"],
  [ends("_fence_gate"), "21. Fence Gates"],
  [ends("_fence"), "20. Fence"],
  [ends("_wall"), "31. Wall"],
  [ends("_button"), "13. Buttons"],
  [ends("_pressure_plate"), "09. Pressure Plate"],
  [ends("_banner"), "10. Banners"],
  [ends("_bed"), "11. Beds"],
  [ends("_shulker_box"), "38. Shulker Box"],
  [ends("_bricks"), "12. Bricks"],
  [has("sandstone"), "23. Sand"],
  [has("quartz"), "35. Quartz"],
  [has("coral"), "17. Coral"],
  [ends("_smithing_template"), "33. Workplaces"],
];

const FOOD = new Set([
  "apple", "golden_apple", "enchanted_golden_apple", "bread", "carrot", "golden_carrot",
  "potato", "baked_potato", "poisonous_potato", "beetroot", "beef", "cooked_beef",
  "porkchop", "cooked_porkchop", "chicken", "cooked_chicken", "mutton", "cooked_mutton",
  "cod", "cooked_cod", "salmon", "cooked_salmon", "tropical_fish", "pufferfish", "rabbit",
  "cooked_rabbit", "rabbit_stew", "mushroom_stew", "beetroot_soup", "suspicious_stew",
  "cookie", "cake", "pumpkin_pie", "melon_slice", "sweet_berries", "glow_berries",
  "dried_kelp", "rotten_flesh", "spider_eye", "chorus_fruit", "honey_bottle",
]);
const PROJECTILES = new Set([
  "egg", "snowball", "ender_pearl", "ender_eye", "wind_charge", "firework_rocket",
  "firework_star", "spectral_arrow", "tipped_arrow", "trident",
]);
const FISHING = new Set(["fishing_rod", "carrot_on_a_stick", "warped_fungus_on_a_stick"]);
const BOWS = new Set(["bow", "crossbow"]);

const ITEM_RULES = [
  [ends("_sword"), "1. Swords"],
  [(n) => n === "sword", "1. Swords"],
  [ends("_pickaxe"), "2. Pickaxes"],
  [ends("_axe"), "3. Axes"],
  [ends("_shovel"), "4. Shovels"],
  [ends("_hoe"), "5. Hoes"],
  [(n) => BOWS.has(n) || ends("_bow")(n), "6. Bows"],
  [(n) => n === "arrow" || ends("_arrow")(n), "7. Arrows"],
  [(n) => PROJECTILES.has(n), "15. Projectiles"],
  [(n) => FISHING.has(n), "12. Fishing"],
  [(n) => /_(helmet|chestplate|leggings|boots)$/.test(n), "8. Armor"],
  [has("horse_armor"), "8. Armor"],
  [has("wolf_armor"), "8. Armor"],
  [ends("_boat"), "9. Boats"],
  [(n) => FOOD.has(n), "10. Food"],
  [(n) => /_(stew|soup|pie)$/.test(n), "10. Food"],
  [ends("_dye"), "16. Dyes"],
  [ends("_bucket"), "19. Buckets"],
  [ends("_spawn_egg"), "31. Spawn Eggs"],
  [ends("_hanging_sign"), "27. Signs"],
  [ends("_sign"), "27. Signs"],
  [has("disc"), "17. Music Discs"],
  [ends("_potion"), "14. Potions"],
  [(n) => /^(potion|splash_potion|lingering_potion)$/.test(n), "14. Potions"],
  [(n) => /_(ingot|nugget|scrap|shard|rod|powder)$/.test(n), "11. Materials"],
  [(n) => /_(sapling|seeds)$/.test(n), "13. Farmables"],
  [ends("_sherd"), "24. Pottery"],
  [ends("_smithing_template"), "29. Trims"],
  [ends("_banner_pattern"), "25. Banner Patterns"],
  [(n) => /_(flower|tulip|daisy|orchid|allium|poppy|dandelion|blossom)$/.test(n), "23. Flowers"],
];

export const classifyBlock = (name) => ({
  category: "20. Blocks",
  subcategory: first(name, BLOCK_RULES, "18. Decoration"),
  file: `${titleCase(name)}.png`,
});

export const classifyItem = (file) => ({
  category: "10. Items",
  subcategory: first(baseName(file), ITEM_RULES, "36. Other"),
  file: `${titleCase(baseName(file))}.png`,
});

export const relPath = (entry) =>
  `${entry.category}/${entry.subcategory ? `${entry.subcategory}/` : ""}${entry.file}`;
