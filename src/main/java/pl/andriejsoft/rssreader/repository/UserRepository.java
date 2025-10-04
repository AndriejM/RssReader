package pl.andriejsoft.rssreader.repository;

import org.springframework.data.repository.CrudRepository;
import pl.andriejsoft.rssreader.entity.UserEntity;

public interface UserRepository extends CrudRepository<UserEntity, Long> {
}
