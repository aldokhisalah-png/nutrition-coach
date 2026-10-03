import csv, json, collections
SR='sr/FoodData_Central_sr_legacy_food_csv_2018-04/'; FF='ff/FoodData_Central_foundation_food_csv_2026-04-30/'
def rows(p):
    with open(p, newline='', encoding='utf-8') as f: return list(csv.DictReader(f))
# nutrient id -> (nbr, name, unit) for both datasets
NUT={}
for base in (SR, FF):
    for r in rows(base+'nutrient.csv'): NUT[r['id']]=(r['nutrient_nbr'], r['name'], r['unit_name'])
WANT_IDS=set()
def load_food_nutrients(base, fdc_ids):
    out=collections.defaultdict(dict)
    with open(base+'food_nutrient.csv', newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if r['fdc_id'] in fdc_ids:
                nbr,name,unit=NUT.get(r['nutrient_id'],(None,None,None))
                if nbr and r['amount']!='': out[r['fdc_id']][nbr.split('.')[0] if nbr.endswith('.0') else nbr]=(float(r['amount']),unit,name)
    return out
