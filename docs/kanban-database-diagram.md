# Kendram data model diagram

> **Important architecture note:** the current application persists data in MongoDB/Mongoose. The internship brief explicitly asks for a relational schema. This diagram documents current logical relationships; it does not claim the application has been migrated to SQL. Confirm with the YuvaIntern mentor whether PostgreSQL/MySQL is mandatory before treating the relational-schema requirement as complete.

~~~mermaid
erDiagram
  USER ||--o{ PROJECT : owns
  USER ||--o{ PROJECT_MEMBER : joins
  PROJECT ||--o{ PROJECT_MEMBER : contains
  PROJECT ||--o{ TASK : tracks
  USER ||--o{ TASK : creates
  USER o|--o{ TASK : assigned_to
  TASK ||--o{ COMMENT : has
  USER ||--o{ COMMENT : writes
  TASK ||--o{ ACTIVITY_LOG : records
  USER ||--o{ ACTIVITY_LOG : performs
  TASK ||--o{ TASK_DEPENDENCY : predecessor
  TASK ||--o{ TASK_DEPENDENCY : successor
  USER {
    ObjectId _id PK
    string name
    string email UK
    string passwordHash
    string role
  }
  PROJECT {
    ObjectId _id PK
    ObjectId ownerId FK
    string name
    string status
    date dueDate
  }
  PROJECT_MEMBER {
    ObjectId _id PK
    ObjectId projectId FK
    ObjectId userId FK
    string projectRole
  }
  TASK {
    ObjectId _id PK
    ObjectId projectId FK
    ObjectId assigneeId FK
    ObjectId createdBy FK
    string title
    string status
    string priority
    string[] labels
    int version
    date dueDate
  }
  COMMENT {
    ObjectId _id PK
    ObjectId taskId FK
    ObjectId userId FK
    string message
  }
  ACTIVITY_LOG {
    ObjectId _id PK
    ObjectId userId FK
    string entityType
    ObjectId entityId
    string action
    date createdAt
  }
  TASK_DEPENDENCY {
    ObjectId _id PK
    ObjectId predecessorTaskId FK
    ObjectId successorTaskId FK
  }
~~~

## Missing explicit entities compared with the brief

- A dedicated Board entity and Column entity are not part of the current persistence model; task status currently acts as the workflow state.
- The current model is document-oriented rather than a normalized relational schema.
- A relational implementation should define foreign keys, uniqueness constraints, indexes and a migration/seed strategy if the mentor requires SQL.
