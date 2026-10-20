import joblib
from fastapi import FastAPI
from pydantic import BaseModel,Field
import pandas as pd
from typing import Literal
from fastapi.middleware.cors import CORSMiddleware
from leaderboard import router as leaderboard_router

Model = joblib.load("Mental_Health_Model.pkl")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(leaderboard_router)

class Studentdata(BaseModel):
    Age:                      int = Field(...,ge=18,le=100)
    Gender:                   Literal['Male', 'Female']
    Country:                  str
    Academic_Level:           Literal['Undergraduate', 'Graduate', 'High School']
    Most_Used_Platform:       Literal[ 'Facebook','LinkedIn','Instagram','Snapchat','Twitter','YouTube','TikTok','LINE', 'KakaoTalk', 'VKontakte',  'WhatsApp',    'WeChat']
    Purpose_Of_Use:           Literal['Networking', 'Education', 'Entertainment', 'News']
    Avg_Daily_Usage_Hours:    float = Field(...,ge=0,le=12)
    Daily_Unlocks:            int = Field(...,ge=0,le=200)
    Study_Hours:              float = Field(...,ge=0,le=20)
    Physical_Activity_Hours:  float = Field(...,ge=0,le=10)
    Sleep_Hours_Per_Night:    float = Field(...,ge=4,le=18)
    Stress_Level:             Literal['Medium', 'Low', 'Very High', 'High']
    
    
class Response(BaseModel):
    Mental_Health_Score: float

@app.get('/')
def hello():
    return {"Hello Everyone"}

top_country = ['India','USA','Canada','Australia','UK','Germany','Mexico','Turkey','France','Spain']


@app.post('/predict', response_model=Response)
def predict(data:Studentdata):
    
    group_country = data.Country if data.Country in top_country else 'Other'
    
    input= pd.DataFrame([{
        'Age': data.Age,
        'Gender': data.Gender,
        'Country': data.Country,
        'Academic_Level': data.Academic_Level,
        'Most_Used_Platform': data.Most_Used_Platform,
        'Purpose_Of_Use': data.Purpose_Of_Use,
        'Avg_Daily_Usage_Hours': data.Avg_Daily_Usage_Hours,
        'Daily_Unlocks': data.Daily_Unlocks,
        'Study_Hours': data.Study_Hours,
        'Physical_Activity_Hours': data.Physical_Activity_Hours,
        'Sleep_Hours_Per_Night': data.Sleep_Hours_Per_Night,
        'Stress_Level': data.Stress_Level,
        'Group_Country': group_country
    }])
    
    prediction = Model.predict(input)[0]
    return Response(Mental_Health_Score=round(prediction,2))

