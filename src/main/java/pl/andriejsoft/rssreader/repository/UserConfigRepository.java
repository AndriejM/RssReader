package pl.andriejsoft.rssreader.repository;

import org.springframework.data.repository.CrudRepository;
import pl.andriejsoft.rssreader.entity.UserConfigEntity;

public interface UserConfigRepository extends CrudRepository<UserConfigEntity, Long> {

}
