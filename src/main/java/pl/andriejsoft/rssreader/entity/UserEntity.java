package pl.andriejsoft.rssreader.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "app_user")
public class UserEntity {


    @Id
    @GeneratedValue(strategy = GenerationType.AUTO, generator = "global_sequence")
    @SequenceGenerator(name = "global_sequence", sequenceName = "global_sequence", allocationSize = 1)
    private Long id;

    @Column(name = "user_name")
    private String userName;
}
