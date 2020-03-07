const fs = require('fs');
const path = require('path');
const nbt = require('prismarine-nbt');
const util = require('util');
const mcData = require("minecraft-data")("1.8.9");
const objectPath = require("object-path");
const constants = require('./constants');
const helper = require('./helper');

const customResources = require('./custom-resources');

const parseNbt = util.promisify(nbt.parse);

const rarity_order = ['special', 'legendary', 'epic', 'rare', 'uncommon', 'common'];

const max_souls = 190;

function replaceAll(target, search, replacement){
    return target.split(search).join(replacement);
}

function getLevelByXp(xp, runecrafting){
    let xp_table = runecrafting ? constants.runecrafting_xp : constants.leveling_xp;

    if(isNaN(xp)){
        return {
            xp: 0,
            level: 0,
            xpCurrent: 0,
            xpForNext: xp_table[1],
            progress: 0
        };
    }

    let xpTotal = 0;
    let level = 0;

    let xpForNext = Infinity;

    let maxLevel = Object.keys(xp_table).sort((a, b) => Number(a) - Number(b)).map(a => Number(a)).pop();

    for(let x = 1; x <= maxLevel; x++){
        xpTotal += xp_table[x];

        if(xpTotal > xp){
            xpTotal -= xp_table[x];
            break;
        }else{
            level = x;
        }
    }

    let xpCurrent = Math.floor(xp - xpTotal);

    if(level < maxLevel)
        xpForNext = Math.ceil(xp_table[level + 1]);

    let progress = Math.max(0, Math.min(xpCurrent / xpForNext, 1));

    return {
        xp,
        level,
        maxLevel,
        xpCurrent,
        xpForNext,
        progress
    };
}

function getSlayerLevel(slayer){
    let { claimed_levels } = slayer;

    let level = 0;

    for(let level_name in claimed_levels){
        let _level = parseInt(level_name.split("_").pop());

        if(_level > level)
            level = _level;
    }

    return level;
}

function getPetLevel(pet){
    const rarityOffset = constants.pet_rarity_offset[pet.rarity];
    const levels = constants.pet_levels.slice(rarityOffset, rarityOffset + 99);

    const xpMaxLevel = levels.reduce((a, b) => a + b, 0)
    let xpTotal = 0;
    let level = 1;

    let xpForNext = Infinity;

    for(let i = 0; i < 100; i++){
        xpTotal += levels[i];

        if(xpTotal > pet.exp){
            xpTotal -= levels[i];
            break;
        }else{
            level++;
        }
    }

    let xpCurrent = Math.floor(pet.exp - xpTotal);
    let progress;

    if(level < 100){
        xpForNext = Math.ceil(levels[level - 1]);
        progress = Math.max(0, Math.min(xpCurrent / xpForNext, 1));
    }else{
        level = 100;
        xpCurrent = pet.exp - levels[99];
        xpForNext = 0;
        progress = 1;
    }

    return {
        level,
        xpCurrent,
        xpForNext,
        progress,
        xpMaxLevel
    };
}


function getPetLore(pet) {
    let lore = [];

    if (!constants.pet_data[pet.type]) return lore;
    const petData = constants.pet_data[pet.type];

    if (!petData.stats && !petData.perks) {
        lore.push("", "§7Stats and Perks","§7not found.");
        return lore;
    }

    if (!petData.stats || !petData.stats.base) {
        lore.push("", "§7Stats not found.");
    } else { 
        lore.push("");
        let base_stats = petData.stats.base; // Base Stats that is multiplied by level
        let stat_types = ["health", "defense", "true_defense", "strength", "ability_damage", "speed", "crit_chance", "crit_damage", "intelligence"]; // List of Stat Types
        for (let i in stat_types) {
            let stat_type = stat_types[i]; 
            if (base_stats[stat_type]) {
                let pet_stat = getPetStat(petData.stats, pet, stat_type);
                lore.push(pet_stat);
                console.log(pet_stat);
            }
        }
    }

    if (!petData.perks) {
        lore.push("", "§7Perks not found.");
    } else {
        let perk_count = constants.perk_count[pet.rarity];
        if (pet.rarity == "legendary") {
            switch (pet.type) {
                case "PHEONIX":
                    perk_count = 4;

                case "HORSE":
                case "SKELETON_HORSE":
                    perk_count = 2;
            }
        }
        for (let i = 0; i < perk_count; i++) {
            if (!petData.perks[i]) {
                lore.push('', '§8Perk ${(i+1)} not found.');
            } else {
                let pet_perk = getPetPerk(petData.perks[i], pet);
                for (let i in pet_perk) 
                    lore.push(pet_perk[i]);
            }
        }
        lore.push("", "§8Perk Count: §a"+perk_count);
    }

    console.log(lore);
    return lore;
}

function getPetStat(pet_stats, pet, stat_type) {
    let stat_num = pet_stats.base[stat_type];
    let stat_const = 0;
    if (pet_stats[pet.rarity] && pet_stats[pet.rarity][stat_type])
        stat_num += pet_stats[pet.rarity][stat_type];

    if (pet_stats.const && pet_stats.const[stat_type])
        stat_const = pet_stats.const[stat_type];

    stat_num = (stat_num * pet.level.level) + stat_const;

    let stat_string = "§7"+helper.titleCase(stat_type.split("_").join(" "))+": §a";

    // stoopid jerry and his negative intel
    if (stat_num >= 0) 
        stat_string += "+";

    if (stat_type === "crit_damage" || stat_type === "crit_chance")
        stat_string += stat_num.toFixed(1)+"%";
    else 
        stat_string += Math.round(stat_num);

    return stat_string;
}

function getPetPerk(pet_perk, pet) {
    let perk_lore = [''];
    perk_lore.push(pet_perk.name + ":");

    let perk_desc = pet_perk.desc;
    if (pet_perk.stats && pet_perk.stats.base) {
        const perk_arr = pet_perk.stats.base;
        for (let i = 0; i < perk_arr.length; i++) {
            let perk_num = perk_arr[i];
            let perk_const = 0;
            if (pet_perk.stats[pet.rarity] && pet_perk.stats[pet.rarity][i])
                perk_num += pet_perk.stats[pet.rarity][i];
                
            if (pet_perk.stats.const && pet_perk.stats.const[i])
                perk_const = pet_perk.stats.const[i];

            perk_num = (perk_num * pet.level.level) + perk_const;

            perk_desc = perk_desc.replace('{stat}', perk_num.toFixed(1));
        }
    }

    perk_desc = perk_desc.split('\n');

    for (let i in perk_desc) 
        perk_lore.push(perk_desc[i]);

    return perk_lore;
}

function getBonusStat(level, skill, max, incremention){
    let skill_stats = constants.bonus_stats[skill];
    let steps = Object.keys(skill_stats).sort((a, b) => Number(a) - Number(b)).map(a => Number(a));

    let bonus = Object.assign({}, constants.stat_template);

    for(let x = steps[0]; x <= max; x += incremention){
        if(level < x)
            break;

        let skill_step = steps.slice().reverse().find(a => a <= x);

        let skill_bonus = skill_stats[skill_step];

        for(let skill in skill_bonus)
            bonus[skill] += skill_bonus[skill];
    }

    return bonus;
}

// Calculate total health with defense
function getEffectiveHealth(health, defense){
    if(defense <= 0)
        return health;

    return Math.round(health * (1 + defense / 100));
}

async function getBackpackContents(arraybuf){
    let buf = Buffer.from(arraybuf);

    let data = await parseNbt(buf);
    data = nbt.simplify(data);

    let items = data.i;

    for(let item of items){
        item.isInactive = true;
        item.inBackpack = true;
    }

    return items;
}

function getId(item){
    if(objectPath.has(item, 'tag.ExtraAttributes.id'))
        return item.tag.ExtraAttributes.id;
    return null;
}

// Process items returned by API
async function getItems(base64){
    // API stores data as base64 encoded gzipped Minecraft NBT data
    let buf = Buffer.from(base64, 'base64');

    let data = await parseNbt(buf);
    data = nbt.simplify(data);

    let items = data.i;

    // Check backpack contents and add them to the list of items
    for(let [index, item] of items.entries()){
        if(objectPath.has(item, 'tag.display.Name') && (item.tag.display.Name.endsWith('Backpack') || item.tag.display.Name.endsWith('Itchy New Year Cake Bag'))){

            let keys = Object.keys(item.tag.ExtraAttributes);

            let backpackData;

            keys.forEach(key => {
                if(key.endsWith('backpack_data') || key == 'new_year_cake_bag_data')
                    backpackData = item.tag.ExtraAttributes[key];
            });

            if(!Array.isArray(backpackData))
                continue;

            let backpackContents = await getBackpackContents(backpackData);

            backpackContents.forEach(backpackItem => {
                backpackItem.backpackIndex = index;
            });

            item.containsItems = [];

            items.push(...backpackContents);
        }
    }

    let index = 0;

    for(let item of items){
        // Set custom texture for colored leather armor
        if(objectPath.has(item, 'id') && item.id >= 298 && item.id <= 301){
            let types
            let color = [149, 94, 59];

            if(objectPath.has(item, 'tag.ExtraAttributes.color'))
                color = item.tag.ExtraAttributes.color.split(":");

            let type = ["leather_helmet", "leather_chestplate", "leather_leggings", "leather_boots"][item.id - 298].replace('_', '/');

            item.texture_path = `/${type}/${color.join(',')}`;
        }

        // Set raw display name without color and formatting codes
        if(objectPath.has(item, 'tag.display.Name'))
            item.display_name = module.exports.getRawLore(item.tag.display.Name);

        if(objectPath.has(item, 'display_name'))
            if(item.display_name == 'Water Bottle')
                item.Damage = 17;

        // Resolve skull textures to their image path
        if(objectPath.has(item, 'tag.SkullOwner.Properties.textures') && Array.isArray(item.tag.SkullOwner.Properties.textures) && item.tag.SkullOwner.Properties.textures.length > 0){
            try{
                let json = JSON.parse(Buffer.from(item.tag.SkullOwner.Properties.textures[0].Value, 'base64').toString());
                let url = json.textures.SKIN.url;
                let uuid = url.split("/").pop();

                item.texture_path = `/head/${uuid}?v6`;
            }catch(e){

            }
        }

        const customTexture = await customResources.getTexture(item);

        if(customTexture){
            item.animated = customTexture.animated;
            item.texture_path = '/' + customTexture.path;
            item.texture_pack = customTexture.pack.config;
            item.texture_pack.base_path = '/' + path.relative(path.resolve(__dirname, '..', 'public'), customTexture.pack.basePath);
        }

        let lore_raw;

        // Set HTML lore to be displayed on the website
        if(objectPath.has(item, 'tag.display.Lore')){
            lore_raw = item.tag.display.Lore;

            item.lore = '';

            lore_raw.forEach((line, index) => {
                item.lore += module.exports.renderLore(line);

                if(index + 1 <= lore_raw.length)
                    item.lore += '<br>';
            });

            if(objectPath.has(item, 'tag.ExtraAttributes.anvil_uses')){
                let { anvil_uses } = item.tag.ExtraAttributes;

                let hot_potato_count = 0;

                if('hot_potato_count' in item.tag.ExtraAttributes)
                    ({ hot_potato_count } = item.tag.ExtraAttributes);

                anvil_uses -= hot_potato_count;

                if(anvil_uses > 0 && lore_raw)
                    item.lore += "<br>" +  module.exports.renderLore(`§7Anvil Uses: §c${anvil_uses}`);
            }
        }

        let lore = lore_raw ? lore_raw.map(a => a = module.exports.getRawLore(a)) : [];

        let rarity, item_type;

        if(lore.length > 0){
            // Get item type (like "bow") and rarity (like "legendary") from last line of lore
            let rarity_type = lore[lore.length - 1];

            rarity_type = module.exports.splitWithTail(rarity_type, " ", 1);

            rarity = rarity_type[0];

            if(rarity_type.length > 1)
                item_type = rarity_type[1].trim();

            item.rarity = rarity.toLowerCase();

            if(item_type)
                item.type = item_type.toLowerCase();

            item.stats = {};

            // Get item stats from lore
            lore.forEach(line => {
                let split = line.split(":");

                if(split.length < 2)
                    return;

                let stat_type = split[0];
                let stat_value = parseInt(split[1].trim().replace(/,/g, ''));

                switch(stat_type){
                    case 'Damage':
                        item.stats.damage = stat_value;
                        break;
                    case 'Health':
                        item.stats.health = stat_value;
                        break;
                    case 'Defense':
                        item.stats.defense = stat_value;
                        break;
                    case 'Strength':
                        item.stats.strength = stat_value;
                        break;
                    case 'Speed':
                        item.stats.speed = stat_value;
                        break;
                    case 'Crit Chance':
                        item.stats.crit_chance = stat_value;
                        break;
                    case 'Crit Damage':
                        item.stats.crit_damage = stat_value;
                        break;
                    case 'Intelligence':
                        item.stats.intelligence = stat_value;
                        break;
                }
            });

            // Apply Speed Talisman speed bonus
            if(objectPath.has(item, 'tag.ExtraAttributes.id') && item.tag.ExtraAttributes.id == 'SPEED_TALISMAN'){
                lore.forEach(line => {
                    if(line.startsWith('Gives')){
                        let split = line.split("Gives +");

                        if(split.length < 2)
                            return;

                        let speed = parseInt(split[1]);

                        if(!isNaN(speed))
                            item.stats.speed = speed;
                    }
                })
            }
        }

        // Add snow canon and blaster to weapons
        if(objectPath.has(item, 'tag.ExtraAttributes.id') && ['SNOW_CANNON', 'SNOW_BLASTER'].includes(item.tag.ExtraAttributes.id))
            item.type = 'bow';

        // Workaround for detecting item types if another language is set by the player on Hypixel
        if(objectPath.has(item, 'tag.ExtraAttributes.id') && item.tag.ExtraAttributes.id != 'ENCHANTED_BOOK'){
            if(objectPath.has(item, 'tag.ExtraAttributes.enchantments')){
                if('sharpness' in item.tag.ExtraAttributes.enchantments
                || 'crticial' in item.tag.ExtraAttributes.enchantments
                || 'ender_slayer' in item.tag.ExtraAttributes.enchantments
                || 'execute' in item.tag.ExtraAttributes.enchantments
                || 'first_strike' in item.tag.ExtraAttributes.enchantments
                || 'giant_killer' in item.tag.ExtraAttributes.enchantments
                || 'lethality' in item.tag.ExtraAttributes.enchantments
                || 'life_steal' in item.tag.ExtraAttributes.enchantments
                || 'looting' in item.tag.ExtraAttributes.enchantments
                || 'luck' in item.tag.ExtraAttributes.enchantments
                || 'scavenger' in item.tag.ExtraAttributes.enchantments
                || 'vampirism' in item.tag.ExtraAttributes.enchantments
                || 'bane_of_arthropods' in item.tag.ExtraAttributes.enchantments
                || 'smite' in item.tag.ExtraAttributes.enchantments)
                    item.type = 'sword';

                if('power' in item.tag.ExtraAttributes.enchantments
                || 'aiming' in item.tag.ExtraAttributes.enchantments
                || 'dragon_hunter' in item.tag.ExtraAttributes.enchantments
                || 'infinite_quiver' in item.tag.ExtraAttributes.enchantments
                || 'power' in item.tag.ExtraAttributes.enchantments
                || 'snipe' in item.tag.ExtraAttributes.enchantments
                || 'punch' in item.tag.ExtraAttributes.enchantments
                || 'flame' in item.tag.ExtraAttributes.enchantments
                || 'piercing' in item.tag.ExtraAttributes.enchantments)
                    item.type = 'bow';

                if('angler' in item.tag.ExtraAttributes.enchantments
                || 'blessing' in item.tag.ExtraAttributes.enchantments
                || 'caster' in item.tag.ExtraAttributes.enchantments
                || 'frail' in item.tag.ExtraAttributes.enchantments
                || 'luck_of_the_sea' in item.tag.ExtraAttributes.enchantments
                || 'lure' in item.tag.ExtraAttributes.enchantments
                || 'magnet' in item.tag.ExtraAttributes.enchantments)
                    item.type = 'fishing rod';
            }
        }

        if(!objectPath.has(item, 'display_name') && objectPath.has(item, 'id')){
            let vanillaItem = mcData.items[item.id];

            if(vanillaItem && objectPath.has(vanillaItem, 'displayName'))
                item.display_name = vanillaItem.displayName;
        }
    }

    for(let item of items){
        if(item.inBackpack){
            items[item.backpackIndex].containsItems.push(Object.assign({}, item));
        }
    }

    items = items.filter(a => !a.inBackpack);

    return items;
}

module.exports = {
    splitWithTail: (string, delimiter, count) => {
        let parts = string.split(delimiter);
        let tail = parts.slice(count).join(delimiter);
        let result = parts.slice(0,count);
        result.push(tail);

        return result;
    },

    getBaseStats: () => {
        return constants.base_stats;
    },

    getLevelByXp: (xp) => {
        let xpTotal = 0;
        let level = 0;

        let maxLevel = Object.keys(constants.leveling_xp).sort((a, b) => Number(a) - Number(b)).map(a => Number(a)).pop();

        for(let x = 1; x <= maxLevel; x++){
            xpTotal += constants.leveling_xp[x];

            if(xp >= xpTotal)
                level = x;
        }

        return level;
    },

    // Get skill bonuses for a specific skill
    getBonusStat: (level, skill, incremention) => {
        let skill_stats = constants.bonus_stats[skill];
        let steps = Object.keys(skill_stats).sort((a, b) => Number(a) - Number(b)).map(a => Number(a));

        let bonus = {
            health: 0,
            defense: 0,
            strength: 0,
            damage_increase: 0,
            speed: 0,
            crit_chance: 0,
            crit_damage: 0,
            intelligence: 0,
            damage_multiplicator: 1
        };

        for(let x = steps[0]; x <= steps[steps.length - 1]; x += incremention){
            if(level < x)
                break;

            let skill_step = steps.slice().reverse().find(a => a <= x);

            let skill_bonus = skill_stats[skill_step];

            for(let skill in skill_bonus)
                bonus[skill] += skill_bonus[skill];
        }

        return bonus;
    },

    getEffectiveHealth: (health, defense) => {
        return getEffectiveHealth(health, defense);
    },

    // Convert Hypixel rank prefix to HTML
    rankPrefix: player => {
        let output = "";
        let rankName = 'NONE';
        let rank;

        if('packageRank' in player)
            rankName = player.packageRank;

        if('newPackageRank'  in player)
            rankName = player.newPackageRank;

        if('rank' in player)
            rankName = player.rank;

        if('prefix' in player)
            rankName = module.exports.getRawLore(player.prefix).replace(/\[|\]/g, '');

        if(rankName in constants.ranks)
            rank = constants.ranks[rankName];

        if(!rank)
            return output;

        let rankColor = constants.minecraft_formatting[rank.color];

        rankColor = rankColor.niceColor || rankColor.color;

        let plusColor = null;
        let plusText = null;

        if('monthlyRankColor' in player && 'monthlyPackageRank' in player && player.monthlyPackageRank != 'NONE'){
            rankColor = constants.minecraft_formatting[constants.color_names[player.monthlyRankColor]];
            rankColor = rankColor.niceColor || rankColor.color;
        }

        if('plus' in rank){
            plusText = rank.plus;
            plusColor = rankColor;
        }

        if(plusText && 'rankPlusColor' in player){
            plusColor = constants.minecraft_formatting[constants.color_names[player.rankPlusColor]];
            plusColor = plusColor.niceColor || plusColor.color;
        }

        output = `<div class="rank-tag ${plusText ? 'rank-plus' : ''}"><div class="rank-name" style="background-color: ${rankColor}">${rank.tag}</div>`;

        if(plusText)
            output += `<div class="rank-plus" style="background-color: ${plusColor}">${plusText}</div>`;

        output += `</div>`;

        return output;
    },

    // Convert Minecraft lore to HTML
    renderLore: text => {
        let output = "";
        let spansOpened = 0;

        const parts = text.split("§");

        for(const part of parts){
            const code = part.substring(0, 1);
            const content = part.substring(1);

            if(code in constants.minecraft_formatting){
                const format = constants.minecraft_formatting[code];

                if(format.type == 'color'){
                    for(; spansOpened > 0; spansOpened--)
                        output += "</span>";

                    output += `<span style="${format.css}">${content}`;

                    spansOpened++;
                }else if(format.type == 'format'){
                    output += `<span style="${format.css}">${content}`;

                    spansOpened++;
                }else if(format.type == 'reset'){
                    for(; spansOpened > 0; spansOpened--)
                        output += "</span>";

                    output += content;
                }
            }
        }

        for(; spansOpened > 0; spansOpened--)
            output += "</span>";

        return output;
    },

    // Get Minecraft lore without the color and formatting codes
    getRawLore: (text) => {
        let output = "";
        let parts = text.split("§");

        parts.forEach(part => {
            output += part.substr(1);
        });

        return output;
    },

    getItems: async (profile) => {
        let output = {};

        // Process inventories returned by API
        let armor = 'inv_armor' in profile ? await getItems(profile.inv_armor.data) : [];
        let inventory = 'inv_contents' in profile ? await getItems(profile.inv_contents.data) : [];
        let enderchest = 'ender_chest_contents' in profile ? await getItems(profile.ender_chest_contents.data) : [];
        let talisman_bag = 'talisman_bag' in profile ? await getItems(profile.talisman_bag.data) : [];
        let fishing_bag = 'fishing_bag' in profile ? await getItems(profile.fishing_bag.data) : [];
        let quiver = 'quiver' in profile ? await getItems(profile.quiver.data) : [];
        let potion_bag = 'potion_bag' in profile ? await getItems(profile.potion_bag.data) : [];
        let candy_bag = 'candy_inventory_contents' in profile ? await getItems(profile.candy_inventory_contents.data) : [];

        output.armor = armor.filter(a => Object.keys(a).length != 0);
        output.inventory = inventory
        output.enderchest = enderchest;
        output.talisman_bag = talisman_bag;
        output.fishing_bag = fishing_bag;
        output.quiver = quiver;
        output.potion_bag = potion_bag;

        const all_items = armor.concat(inventory, enderchest, talisman_bag, fishing_bag, quiver, potion_bag);

        for(const [index, item] of all_items.entries()){
            item.item_index = index;

            if('containsItems' in item && Array.isArray(item.containsItems))
                item.containsItems.forEach(a => a.backpackIndex = item.item_index);
        }

        // All items not in the inventory or accessory bag should be inactive so they don't contribute to the total stats
        enderchest = enderchest.map(a => Object.assign({ isInactive: true}, a) );

        // Add candy bag contents as backpack contents to candy bag
        for(let item of all_items){
            if(getId(item) == 'TRICK_OR_TREAT_BAG')
                item.containsItems = candy_bag;
        }

        const talismans = [];

        // Add talismans from inventory
        for(const talisman of inventory.filter(a => a.type == 'accessory')){
            const id = getId(talisman);

            if(id === null)
                continue;

            const insertTalisman = Object.assign({ isUnique: true, isInactive: false }, talisman);

            if(talismans.filter(a => !a.isInactive && getId(a) == id).length > 0)
                insertTalisman.isInactive = true;

            if(talismans.filter(a =>a.tag.ExtraAttributes.id == id).length > 0)
                insertTalisman.isUnique = false;

            talismans.push(insertTalisman);
        }

        // Add talismans from accessory bag if not already in inventory
        for(const talisman of talisman_bag){
            const id = getId(talisman);

            if(id === null)
                continue;

            const insertTalisman = Object.assign({ isUnique: true, isInactive: false }, talisman);

            if(talismans.filter(a => !a.isInactive && getId(a) == id).length > 0)
                insertTalisman.isInactive = true;

            if(talismans.filter(a => a.tag.ExtraAttributes.id == id).length > 0)
                insertTalisman.isUnique = false;

            talismans.push(insertTalisman);
        }

        // Add inactive talismans from enderchest and backpacks
        for(const item of inventory.concat(enderchest)){
            let items = [item];

            if(item.type != 'accessory' && 'containsItems' in item && Array.isArray(item.containsItems))
                items = item.containsItems.slice(0);

            for(const talisman of items.filter(a => a.type == 'accessory')){
                const id = talisman.tag.ExtraAttributes.id;

                const insertTalisman = Object.assign({ isUnique: true, isInactive: true }, talisman);

                if(talismans.filter(a => getId(a) == id).length > 0)
                    insertTalisman.isUnique = false;

                talismans.push(insertTalisman);
            }
        }

        // Don't account for lower tier versions of the same talisman
        for(const talisman of talismans){
            const id = getId(talisman);

            if(id in constants.talisman_upgrades){
                const talismanUpgrades = constants.talisman_upgrades[id];

                if(talismans.filter(a => !a.isInactive && talismanUpgrades.includes(getId(a))).length > 0)
                    talisman.isInactive = true;

                if(talismans.filter(a => talismanUpgrades.includes(getId(a))).length > 0)
                    talisman.isUnique = false;
            }

            if(id in constants.talisman_duplicates){
                const talismanDuplicates = constants.talisman_duplicates[id];

                if(talismans.filter(a => talismanDuplicates.includes(getId(a))).length > 0)
                    talisman.isUnique = false;
            }
        }

        // Add New Year Cake Bag health bonus (1 per unique cake)
        for(let talisman of talismans){
            let id = talisman.tag.ExtraAttributes.id;
            let cakes = [];

            if(id == 'NEW_YEAR_CAKE_BAG' && objectPath.has(talisman, 'containsItems') && Array.isArray(talisman.containsItems)){
                talisman.stats.health = 0;

                for(let item of talisman.containsItems){
                    if(objectPath.has(item, 'tag.ExtraAttributes.new_years_cake') && !cakes.includes(item.tag.ExtraAttributes.new_years_cake)){
                        talisman.stats.health++;
                        cakes.push(item.tag.ExtraAttributes.new_years_cake);
                    }
                }
            }
        }

        // Add base name without reforge
        for(const talisman of talismans){
            talisman.base_name = talisman.display_name;

            if(objectPath.has(talisman, 'tag.ExtraAttributes.modifier')){
                talisman.base_name = talisman.display_name.split(" ").slice(1).join(" ");
                talisman.reforge = talisman.tag.ExtraAttributes.modifier
            }
        }

        output.talismans = talismans;
        output.weapons = all_items.filter(a => a.type == 'sword' || a.type == 'bow' || a.type == 'fishing rod');

        // Check if inventory access disabled by user
        if(inventory.length == 0)
            output.no_inventory = true;

        // Sort talismans and weapons by rarity
        output.weapons = output.weapons.sort((a, b) => rarity_order.indexOf(a.rarity) - rarity_order.indexOf(b.rarity));

        output.talismans = output.talismans.sort((a, b) => {
            const rarityOrder = rarity_order.indexOf(a.rarity) - rarity_order.indexOf(b.rarity);

            if(rarityOrder == 0)
                return (a.isInactive === b.isInactive) ? 0 : a.isInactive? 1 : -1;

            return rarityOrder;
        });

        let swords = output.weapons.filter(a => a.type == 'sword');
        let bows = output.weapons.filter(a => a.type == 'bow');

        if(swords.length > 0)
            output.highest_rarity_sword = swords.filter(a => a.rarity == swords[0].rarity).sort((a, b) => a.item_index - b.item_index)[0];

        if(bows.length > 0)
            output.highest_rarity_bow = bows.filter(a => a.rarity == bows[0].rarity).sort((a, b) => a.item_index - b.item_index)[0];

        if(armor.filter(a => Object.keys(a).length > 1).length == 4){

            let output_name = "";

            armor.forEach(armorPiece => {
                let name = armorPiece.display_name;

                if(objectPath.has(armor[0], 'tag.ExtraAttributes.modifier'))
                    name = name.split(" ").slice(1).join(" ");

                armorPiece.armor_name = name;
            });

            if(armor.filter(a => objectPath.has(a, 'tag.ExtraAttributes.modifier')
            && a.tag.ExtraAttributes.modifier == armor[0].tag.ExtraAttributes.modifier).length == 4)
                output_name += armor[0].display_name.split(" ")[0] + " ";

            if(armor.filter(a => a.armor_name.split(" ")[0] == armor[0].armor_name.split(" ")[0]).length == 4){
                let base_name = armor[0].armor_name.split(" ");
                base_name.pop();

                output_name += base_name.join(" ");

                if(!output_name.endsWith("Armor"))
                    output_name += " Armor";

                output.armor_set = output_name;
            }
        }

        return output;
    },

    getStats: async (profile, items) => {
        let output = {};

        output.stats = Object.assign({}, constants.base_stats);

        if(isNaN(profile.fairy_souls_collected))
            profile.fairy_souls_collected = 0;

        output.fairy_bonus = {};

        if(profile.fairy_exchanges > 0){
            let fairyBonus = getBonusStat(profile.fairy_exchanges * 5, 'fairy_souls', max_souls, 5);
            output.fairy_bonus = Object.assign({}, fairyBonus);

            // Apply fairy soul bonus
            for(let stat in fairyBonus)
                output.stats[stat] += fairyBonus[stat];
        }

        output.fairy_souls = { collected: profile.fairy_souls_collected, total: max_souls, progress: Math.min(profile.fairy_souls_collected / max_souls, 1) };

        // Apply skill bonuses
        if('experience_skill_farming' in profile
        || 'experience_skill_mining' in profile
        || 'experience_skill_combat' in profile
        || 'experience_skill_foraging' in profile
        || 'experience_skill_fishing' in profile
        || 'experience_skill_enchanting' in profile
        || 'experience_skill_alchemy' in profile
        || 'experience_skill_carpentry' in profile
        || 'experience_skill_runecrafting' in profile){
            let average_level = 0;

            let levels = {
                farming: getLevelByXp(profile.experience_skill_farming),
                mining: getLevelByXp(profile.experience_skill_mining),
                combat: getLevelByXp(profile.experience_skill_combat),
                foraging: getLevelByXp(profile.experience_skill_foraging),
                fishing: getLevelByXp(profile.experience_skill_fishing),
                enchanting: getLevelByXp(profile.experience_skill_enchanting),
                alchemy: getLevelByXp(profile.experience_skill_alchemy),
                carpentry: getLevelByXp(profile.experience_skill_carpentry),
                runecrafting: getLevelByXp(profile.experience_skill_runecrafting, true),
            };

            output.skill_bonus = {};

            for(let skill in levels){
                if(skill != 'runecrafting' && skill != 'carpentry')
                    average_level += levels[skill].level + levels[skill].progress;

                let skillBonus = getBonusStat(levels[skill].level, `${skill}_skill`, 50, 1);

                output.skill_bonus[skill] = Object.assign({}, skillBonus);

                for(let stat in skillBonus)
                    output.stats[stat] += skillBonus[stat];
            }

            output.average_level = +(average_level / (Object.keys(levels).length - 2)).toFixed(1);

            output.levels = Object.assign({}, levels);
        }

        // Apply slayer bonuses
        if('slayer_bosses' in profile){
            output.slayer_bonus = {};

            let slayers = {};

            if(objectPath.has(profile, 'slayer_bosses.zombie.claimed_levels'))
                slayers.zombie = getSlayerLevel(profile.slayer_bosses.zombie);

            if(objectPath.has(profile, 'slayer_bosses.spider.claimed_levels'))
                slayers.spider = getSlayerLevel(profile.slayer_bosses.spider);

            if(objectPath.has(profile, 'slayer_bosses.wolf.claimed_levels'))
                slayers.wolf = getSlayerLevel(profile.slayer_bosses.wolf);

            for(let slayer in slayers){
                let slayerBonus = getBonusStat(slayers[slayer], `${slayer}_slayer`, 50, 1);

                output.slayer_bonus[slayer] = Object.assign({}, slayerBonus);

                for(let stat in slayerBonus)
                    output.stats[stat] += slayerBonus[stat];
            }

            output.slayers = Object.assign({}, slayers);
        }

        // Apply all harp bonuses when Melody's Hair has been acquired
        if(items.talismans.filter(a => objectPath.has(a, 'tag.ExtraAttributes.id') && a.tag.ExtraAttributes.id == 'MELODY_HAIR').length == 1)
            output.stats.intelligence += 26;

        output.base_stats = Object.assign({}, output.stats);

        // Apply basic armor stats
        items.armor.forEach(item => {
            for(let stat in item.stats)
                output.stats[stat] += item.stats[stat];
        });

        // Apply Lapis Armor full set bonus of +60 HP
        if(items.armor.filter(a => objectPath.has(a, 'tag.ExtraAttributes.id') && a.tag.ExtraAttributes.id.startsWith('LAPIS_ARMOR_')).length == 4)
            output.stats['health'] += 60;

        // Apply Emerald Armor full set bonus of +1 HP and +1 Defense per 3000 emeralds in collection with a maximum of 300
        if(objectPath.has(profile, 'collection.EMERALD')
        && !isNaN(profile.collection.EMERALD)
        && items.armor.filter(a => objectPath.has(a, 'tag.ExtraAttributes.id') && a.tag.ExtraAttributes.id.startsWith('EMERALD_ARMOR_')).length == 4){
            let emerald_bonus = Math.min(350, Math.floor(profile.collection.EMERALD / 3000));

            output.stats.health += emerald_bonus;
            output.stats.defense += emerald_bonus;
        }

        // Apply Fairy Armor full set bonus of +10 Speed
        if(items.armor.filter(a => objectPath.has(a, 'tag.ExtraAttributes.id') && a.tag.ExtraAttributes.id.startsWith('FAIRY_')).length == 4)
            output.stats.speed += 10;

        // Apply Speedster Armor full set bonus of +20 Speed
        if(items.armor.filter(a => objectPath.has(a, 'tag.ExtraAttributes.id') && a.tag.ExtraAttributes.id.startsWith('SPEEDSTER_')).length == 4)
            output.stats.speed += 20;

        // Apply Young Dragon Armor full set bonus of +70 Speed
        if(items.armor.filter(a => objectPath.has(a, 'tag.ExtraAttributes.id') && a.tag.ExtraAttributes.id.startsWith('YOUNG_DRAGON_')).length == 4)
            output.stats.speed += 70;

        // Apply stats of active talismans
        items.talismans.filter(a => Object.keys(a).length != 0 && !a.isInactive).forEach(item => {
            for(let stat in item.stats)
                output.stats[stat] += item.stats[stat];
        });

        // Apply Mastiff Armor full set bonus of +50 HP per 1% Crit Damage
        if(items.armor.filter(a => objectPath.has(a, 'tag.ExtraAttributes.id') && a.tag.ExtraAttributes.id.startsWith('MASTIFF_')).length == 4)
            output.stats.health += 50 * output.stats.crit_damage;

        // Apply +5 Defense and +5 Strength of Day/Night Crystal only if both are owned as this is required for a permanent bonus
        if(items.talismans.filter(a => objectPath.has(a, 'tag.ExtraAttributes.id') && !a.isInactive && ["DAY_CRYSTAL", "NIGHT_CRYSTAL"].includes(a.tag.ExtraAttributes.id)).length == 2){
            output.stats.defense += 5;
            output.stats.strength += 5;
        }

        // Apply Obsidian Chestplate bonus of +1 Speed per 20 Obsidian in inventory
        if(items.armor.filter(a => objectPath.has(a, 'tag.ExtraAttributes.id') && a.tag.ExtraAttributes.id == ('OBSIDIAN_CHESTPLATE')).length == 1){
            let obsidian = 0;

            for(let item of items.inventory){
                if(item.id == 49)
                    obsidian += item.Count;
            }

            output.stats.speed += Math.floor(obsidian / 20);
        }

        output.stats.effective_health = getEffectiveHealth(output.stats.health, output.stats.defense);

        output.weapon_stats = {};

        items.weapons.forEach(item => {
            let stats = Object.assign({}, output.stats);

            // Apply held weapon stats
            for(let stat in item.stats){
                stats[stat] += item.stats[stat];
            }

            // Add crit damage from held weapon to Mastiff Armor full set bonus
            if(items.armor.filter(a => objectPath.has(a, 'tag.ExtraAttributes.id') && a.tag.ExtraAttributes.id.startsWith('MASTIFF_')).length == 4)
                stats.health += 50 * item.stats.crit_damage;

            stats.effective_health = getEffectiveHealth(stats.health, stats.defense);

            // Apply Superior Dragon Armor full set bonus of 5% stat increase
            if(items.armor.filter(a => objectPath.has(a, 'tag.ExtraAttributes.id') && a.tag.ExtraAttributes.id.startsWith('SUPERIOR_DRAGON_')).length == 4)
                for(let stat in stats)
                    stats[stat] = Math.floor(stats[stat] * 1.05);

            output.weapon_stats[item.item_index] = stats;

            // Stats shouldn't go into negative
            for(let stat in stats)
                output.weapon_stats[item.item_index][stat] = Math.max(0, stats[stat]);
        });

        // Apply Superior Dragon Armor full set bonus of 5% stat increase
        if(items.armor.filter(a => objectPath.has(a, 'tag.ExtraAttributes.id') && a.tag.ExtraAttributes.id.startsWith('SUPERIOR_DRAGON_')).length == 4)
            for(let stat in output.stats)
                output.stats[stat] = Math.floor(output.stats[stat] * 1.05);

        // Stats shouldn't go into negative
        for(let stat in output.stats)
            output.stats[stat] = Math.max(0, output.stats[stat]);

        let killsDeaths = [];

        for(let stat in profile.stats){
            if(stat.startsWith("kills_"))
                killsDeaths.push({ type: 'kills', entityId: stat.replace("kills_", ""), amount: profile.stats[stat] });

            if(stat.startsWith("deaths_"))
                killsDeaths.push({ type: 'deaths', entityId: stat.replace("deaths_", ""), amount: profile.stats[stat] });
        }

        for(const stat of killsDeaths){
            let { entityId } = stat;

            if(entityId in constants.mob_names){
                stat.entityName = constants.mob_names[entityId];
                continue;
            }

            let entityName = "";

            entityId.split("_").forEach((split, index) => {
                entityName += split.charAt(0).toUpperCase() + split.slice(1);

                if(index < entityId.split("_").length - 1)
                    entityName += " ";
            });

            stat.entityName = entityName;
        }

        output.kills = killsDeaths.filter(a => a.type == 'kills').sort((a, b) => b.amount - a.amount);
        output.deaths = killsDeaths.filter(a => a.type == 'deaths').sort((a, b) => b.amount - a.amount);

        return output;
    },

    getPets: async profile => {
        let output = [];

        if(!objectPath.has(profile, 'pets'))
            return output;

        for(const pet of profile.pets){
            if(!('tier' in pet))
                continue;

            pet.rarity = pet.tier.toLowerCase();
            pet.level = getPetLevel(pet);

            const petData = constants.pet_data[pet.type];

            if(!petData)
                continue;

            if (petData.head)
                pet.texture_path = petData.head;
            else 
                pet.texture_path = "/head/c2bf95d22e152d8a3a0476444c4114044903b937a679a00b12b2f174a1075499";

            let title = "pet";
            if (petData.title)
                title = petData.title;

            let lore = [
                `§8${helper.capitalizeFirstLetter(petData.type)} ${helper.capitalizeFirstLetter(title)}`,
            ];

            petExtraLore = getPetLore(pet);
            for (let i in petExtraLore) {
                lore.push(petExtraLore[i]);
            }

            lore.push('');

            if(pet.level.level < 100){
                lore.push(
                    `§7Progress to Level ${pet.level.level + 1}: §e${(pet.level.progress * 100).toFixed(1)}%`
                );

                let levelBar = '';

                for(let i = 0; i < 20; i++){
                    if(pet.level.progress > i / 20)
                        levelBar += '§2';
                    else
                        levelBar += '§f';
                    levelBar += '-';
                }

                levelBar += ` §e${pet.level.xpCurrent.toLocaleString()} §6/ §e${helper.formatNumber(pet.level.xpForNext, false, 10)}`;

                lore.push(levelBar);
            }else{
                lore.push(
                    '§bMAX LEVEL'
                );
            }

            lore.push(
                '',
                `§7Total XP: §e${helper.formatNumber(pet.exp, true, 10)} §6/ §e${helper.formatNumber(pet.level.xpMaxLevel, true, 10)}`
            );

            pet.lore = '';

            lore.forEach((line, index) => {
                pet.lore += module.exports.renderLore(line);

                if(index + 1 <= lore.length)
                    pet.lore += '<br>';
            });

            pet.display_name = helper.titleCase(pet.type.replace(/\_/g, ' '));

            output.push(pet);
        }

        output = output.sort((a, b) => {
            if(a.active === b.active)
                if(a.rarity == b.rarity)
                    return a.type < b.type ? -1 : 1;
                else
                    return rarity_order.indexOf(a.rarity) - rarity_order.indexOf(b.rarity)

            return a.active? -1 : 1
        });

        return output;
    }
}
