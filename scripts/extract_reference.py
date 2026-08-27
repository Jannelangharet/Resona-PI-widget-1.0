"""Extract private, real comparison data. Never commit the output or the PBIX.
Usage: python scripts/extract_reference.py INPUT.pbix work/reference.json
Requires pbixray. The widget itself has no Python or Power BI dependency.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from pbixray import PBIXRay

model = PBIXRay(sys.argv[1])
table = model.get_table('Apartment')
description = table['BIP_Namn~Beskrivning'].fillna('')
fields = ['GUID', 'Dimensions~Area', 'BIP_Läge~Våning', 'BIP_Läge~Trapphus',
          'BIP_Namn~Beskrivning', 'Identity Data~LÄGENHET', 'Identity Data~Number', 'IFC Type']
def rows(keyword):
    return json.loads(table.loc[description.str.contains(keyword, case=False), fields].to_json(orient='records', double_precision=15))
result = {'source': 'reference', 'projectId': str(table['Project id'].dropna().iloc[0]),
          'projectName': str(table['Project name'].dropna().iloc[0]), 'buildingId': 'not-recorded',
          'capturedAt': datetime.now(timezone.utc).isoformat(),
          **{category.lower(): rows(category) for category in ['ROK','LBTA','MBTA','LOFT','LOKAL']}}
output = Path(sys.argv[2])
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"Extracted {len(result['rok'])} ROK rows and {len(result['lbta'])} LBTA rows to private local reference.")
