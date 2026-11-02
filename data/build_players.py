# EA FC 26 (sofifa formatı, github.com/ismailoksuz/EAFC26-DataHub data/players.csv) -> players.json
# kullanım: python3 -I build_players.py players.csv players.json
import csv, json, sys
LIG = {'13':'ENG','53':'ESP','19':'GER','16':'FRA','31':'ITA','10':'NED','308':'POR','68':'TUR','4':'BEL'}
GRP = {'GK':'GK','CB':'DEF','LB':'DEF','RB':'DEF','LWB':'DEF','RWB':'DEF',
       'CDM':'MID','CM':'MID','CAM':'MID','LM':'MID','RM':'MID',
       'LW':'FWD','RW':'FWD','ST':'FWD','CF':'FWD'}
def i(v, d=0):
    try: return int(float(v))
    except: return d
best = {}
for x in csv.DictReader(open(sys.argv[1], encoding='utf-8')):
    lg = x['league_id'].split('.')[0]
    if lg not in LIG: continue
    pid = int(x['player_id'])
    if pid in best and i(best[pid]['fifa_update']) >= i(x['fifa_update']): continue
    best[pid] = x
out = []
for pid, x in best.items():
    pos = x['player_positions'].replace(' ', '')
    ovr = i(x['overall'])
    val = i(x['value_eur']) or max(250_000, (ovr-60)**3 * 6000)
    gk = pos.split(',')[0] == 'GK'
    attrs = dict(pac=i(x['pace']), sho=i(x['shooting']), pas=i(x['passing']),
                 dri=i(x['dribbling']), dfn=i(x['defending']), phy=i(x['physic']))
    if gk:  # kaleciler: kalecilik özellikleri
        attrs = dict(pac=i(x.get('goalkeeping_diving')), sho=i(x.get('goalkeeping_handling')),
                     pas=i(x.get('goalkeeping_kicking')), dri=i(x.get('goalkeeping_reflexes')),
                     dfn=i(x.get('goalkeeping_positioning')), phy=i(x.get('goalkeeping_speed')))
    out.append(dict(id=pid, name=x['short_name'], full_name=x['long_name'], positions=pos,
        grp=GRP.get(pos.split(',')[0], 'MID'), ovr=ovr, pot=i(x['potential']), age=i(x['age']),
        nat=x['nationality_name'], club=x['club_name'], lg=LIG[x['league_id'].split('.')[0]],
        val=val, **attrs))
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print(len(out), 'oyuncu')
